:- encoding(utf8).
/*  Staggy — Motor de alocação da grade acadêmica
    SWI-Prolog + library(clpfd) — especificação consolidada v2.7

    Entrada: snapshot imutável no contrato staggy.snapshot.v1 (ET-06).
    Saída:   eventos JSON emitidos pelo predicado Emitir, um por evento:
             incumbente (cada grade completa melhor no vetor hierárquico),
             prova (nível da hierarquia comprovado), decisao (rastreio opcional)
             e resultado (classificação final, sempre o último evento).

    Modelo (ET-02)
      o = (turma t, disciplina d)          obrigação curricular, r(o) = carga(d)/K
      Y(o,p) ∈ {0,1}                       professor p é o responsável por o
      W(o,p,b) ∈ {0,1}                     bloco b da turma t ocupado por d com p
      V(t,b) ∈ {0} ∪ postos(d,p)           conteúdo canônico da posição (0 = vaga)
    Restrições: Σp Y = 1; Σb W(o,p,·) = r(o)·Y(o,p); W ↔ (V = posto(d,p)) (no
    máximo uma aula por posição de turma); Σ W(·,p,b) ≤ 1 por coordenada do
    professor; K·Σ W(·,p,·) ≤ 40; Σo Y(o,p) ≥ 1 por participante; travas.
    Variáveis só existem para alternativas legais (seleção de disciplina,
    blocos selecionados, turno da turma, travas de vaga).

    Otimização lexicográfica (RN-32, ET-05), prazo único (RN-51):
      1. custo primário C — branch-and-bound em profundidade com limite inferior
         comprovado por relaxação e verificação de cobertura docente;
      2. max M_p — reinícios com melhoria estrita (aritmética racional exata);
      3. max M_p − min M_p — idem, com max M_p fixado no ótimo;
      4. chave canônica — rotulação lexicográfica de V na ordem canônica (ET-13).
*/

:- module(alocacao,
          [ resolver_snapshot/3,     % +Snapshot, +Opcoes, :Emitir
            versao_motor/1,
            policy_version/1,
            phi/2,
            custo_bloco/4,           % +K, +NotaDiaTurno, +NotaDisciplina, -Custo
            comparar_ids/3,          % -Ordem, +IdA, +IdB
            comparar_racionais/3,    % -Ordem, +N1/D1, +N2/D2
            binomial/3               % +N, +K, -Coeficiente
          ]).

:- use_module(library(clpfd)).
:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(pairs)).
:- use_module(library(assoc)).
:- use_module(library(utf8)).
:- use_module(library(option)).
:- use_module(library(time)).

:- meta_predicate resolver_snapshot(+, +, 1).

% ---------------------------------------------------------------------------
% Política homologada (CP-02, CP-03, RN-20, RN-26, RN-51). Fixa e versionada:
% não há parâmetro administrativo que a altere (CA-48, CA-72).
% ---------------------------------------------------------------------------

versao_motor('staggy-clpfd-2.7.0').
schema_snapshot('staggy.snapshot.v1').
schema_resultado('staggy.resultado.v1').
versao_chave('staggy.chave.v1').
policy_version('staggy-preferencias-v2.7').

phi(5, 0).
phi(4, 1).
phi(3, 3).
phi(2, 6).
phi(1, 10).

peso_dia_turno(3).
peso_disciplina(2).
teto_aulas(40).
minimo_disciplinas(1).
limite_maximo_segundos(600).

%!  custo_bloco(+K, +NotaDiaTurno, +NotaDisciplina, -Custo) is det.
%   C_bloco = K × [3·φ(nota dia/turno) + 2·φ(nota disciplina)] (CP-03).
custo_bloco(K, NotaDT, NotaD, Custo) :-
    phi(NotaDT, F1),
    phi(NotaD, F2),
    peso_dia_turno(P1),
    peso_disciplina(P2),
    Custo is K * (P1*F1 + P2*F2).

dia_iso('SEGUNDA', 1).
dia_iso('TERCA', 2).
dia_iso('QUARTA', 3).
dia_iso('QUINTA', 4).
dia_iso('SEXTA', 5).
dia_iso('SABADO', 6).
dia_iso('DOMINGO', 7).

turno_cod('MANHA', 1).
turno_cod('TARDE', 2).
turno_cod('NOITE', 3).

tipo_trava(ocupacao).
tipo_trava(vaga_turma).
tipo_trava(vaga_professor).
tipo_trava(fixacao_disciplina_professor).

heuristica('escassez dinamica E(o)=soma_p C(|S(o,p)|, r_restante(o)) apos propagacao; empate por grau de concorrencia (estatico) e ID canonico; valores por menor custo incremental; poda apenas por limite inferior de relaxacao, cobertura docente (emparelhamento de Hall) e escassez nula').

% ---------------------------------------------------------------------------
% Identificadores canônicos (ET-13): IDs opacos comparados pela sequência de
% bytes UTF-8, sem locale nem sufixo numérico ("T1" < "T10" < "T2").
% ---------------------------------------------------------------------------

id_bytes(Id, Bytes) :-
    atom_codes(Id, Codes),
    phrase(utf8_codes(Codes), Bytes).

comparar_ids(Ordem, A, B) :-
    id_bytes(A, BA),
    id_bytes(B, BB),
    compare(Ordem, BA, BB).

bytes_hex(Bytes, Hex) :-
    maplist(byte_hex, Bytes, Partes),
    atomic_list_concat(Partes, Hex).

byte_hex(B, H) :-
    format(atom(H), '~|~`0t~16r~2+', [B]).

%!  comparar_racionais(-Ordem, +N1/D1, +N2/D2) is det.
%   Comparação exata por produto cruzado (CA-70), denominadores positivos.
comparar_racionais(Ordem, N1/D1, N2/D2) :-
    X is N1*D2,
    Y is N2*D1,
    compare(Ordem, X, Y).

racional(N, D, R) :-
    G is gcd(N, D),
    (   G =:= 0
    ->  R = 0/1
    ;   N1 is N // G, D1 is D // G, R = N1/D1
    ).

binomial(N, K, B) :-
    (   (K < 0 ; K > N)
    ->  B = 0
    ;   K1 is min(K, N-K),
        binomial_(1, K1, N, 1, B)
    ).

binomial_(I, K, _, Acc, Acc) :-
    I > K, !.
binomial_(I, K, N, Acc0, B) :-
    Acc is Acc0 * (N - K + I) // I,
    I1 is I + 1,
    binomial_(I1, K, N, Acc, B).

% ---------------------------------------------------------------------------
% Estado da execução (um processo por geração; os testes reiniciam o estado)
% ---------------------------------------------------------------------------

:- dynamic
    i_meta/2,          % Chave, Valor
    i_k/1,
    i_cap/1,           % blocos por professor: teto // K
    i_turma/4,         % TurmaId, SemestreId, Turno, Bytes
    i_disc/4,          % DisciplinaId, SemestreId, Carga, Bytes
    i_coord/4,         % Ci, Dia, Turno, Indice (Ci numera a ordem canônica)
    i_prof/2,          % ProfessorId, Bytes
    i_sel_disc/3,      % ProfessorId, DisciplinaId, Nota
    i_sel_bloco/2,     % ProfessorId, Ci
    i_nota_dt/4,       % ProfessorId, Dia, Turno, Nota
    i_ocup/5,          % TravaId, TurmaId, Ci, DisciplinaId, ProfessorId
    i_vaga_turma/3,    % TravaId, TurmaId, Ci
    i_vaga_prof/3,     % TravaId, ProfessorId, Ci
    i_fix/4,           % TravaId, SemestreId, DisciplinaId, ProfessorId
    i_trava/1,         % TravaId
    i_erro/1.          % diagnóstico de entrada detectado no carregamento

limpar_estado :-
    forall(member(N/A, [i_meta/2, i_k/1, i_cap/1, i_turma/4, i_disc/4, i_coord/4, i_prof/2,
                        i_sel_disc/3, i_sel_bloco/2, i_nota_dt/4, i_ocup/5, i_vaga_turma/3,
                        i_vaga_prof/3, i_fix/4, i_trava/1, i_erro/1]),
           ( functor(H, N, A), retractall(H) )),
    forall(member(G-V, [staggy_inc-none, staggy_ub-inf, staggy_t_primeira-none,
                        staggy_deadline-inf, staggy_rastreio-0, staggy_limites-[],
                        staggy_tempos-[]]),
           nb_setval(G, V)),
    forall(member(F, [staggy_nos, staggy_retrocessos, staggy_podas_limite,
                      staggy_podas_cobertura, staggy_podas_escassez, staggy_podas_colocacao,
                      staggy_solucoes, staggy_decisoes]),
           flag(F, _, 0)).

decorrido_ms(Ms) :-
    nb_getval(staggy_t0, T0),
    get_time(T),
    Ms is round((T - T0) * 1000).

restante(Seg) :-
    nb_getval(staggy_deadline, D),
    (   D == inf
    ->  Seg = 1.0e9
    ;   get_time(T),
        Seg is D - T
    ).

contar(Flag) :-
    flag(Flag, N, N+1).

emitir(Dict) :-
    nb_getval(staggy_emitir, E),
    call(E, Dict).

% ---------------------------------------------------------------------------
% Ponto de entrada
% ---------------------------------------------------------------------------

%!  resolver_snapshot(+Snapshot:dict, +Opcoes:list, :Emitir) is det.
%   Opções: orcamento_ms(Ms) — prazo restante informado pelo supervisor;
%           rastreio(N) — emite as N primeiras decisões da busca (CA-37).
resolver_snapshot(Snap, Opcoes, Emitir) :-
    get_time(T0),
    limpar_estado,
    nb_setval(staggy_t0, T0),
    nb_setval(staggy_emitir, Emitir),
    ids_execucao(Snap, RunId, Hash),
    nb_setval(staggy_ids, RunId-Hash),
    option(rastreio(Rastreio), Opcoes, 0),
    nb_setval(staggy_rastreio, Rastreio),
    catch(resolver_(Snap, Opcoes), Erro, tratar_excecao(Erro)).

ids_execucao(Snap, RunId, Hash) :-
    (   is_dict(Snap), get_dict(run_id, Snap, R), string(R)
    ->  atom_string(RunId, R)
    ;   RunId = null
    ),
    (   is_dict(Snap), get_dict(snapshot_hash, Snap, H), string(H)
    ->  atom_string(Hash, H)
    ;   Hash = null
    ).

resolver_(Snap, Opcoes) :-
    validar_estrutura(Snap, E1),
    (   E1 \== []
    ->  finalizar_sem_grade('ENTRADA_INVALIDA', 'ENTRADA_INVALIDA', provas_nao_executadas, E1)
    ;   carregar_instancia(Snap),
        validar_semantica(E2),
        (   E2 \== []
        ->  finalizar_sem_grade('ENTRADA_INVALIDA', 'ENTRADA_INVALIDA', provas_nao_executadas, E2)
        ;   definir_prazo(Snap, Opcoes),
            resolver_instancia
        )
    ).

definir_prazo(Snap, Opcoes) :-
    get_dict(limite_execucao_segundos, Snap, Lim),
    LimMs is Lim * 1000,
    option(orcamento_ms(Orc), Opcoes, LimMs),
    OrcMs is min(LimMs, Orc),
    Margem is min(2000, OrcMs * 0.05),
    nb_getval(staggy_t0, T0),
    Deadline is T0 + (OrcMs - Margem) / 1000,
    nb_setval(staggy_deadline, Deadline).

% Falha técnica: ERRO_EXECUCAO, preservando o incumbente apenas como candidato
% recuperável, nunca promovido a resultado (RN-66, CA-175, CA-209).
tratar_excecao(Erro) :-
    (   Erro = error(resource_error(Recurso), _)
    ->  Motivo = 'LIMITE_MEMORIA',
        format(atom(Msg), 'O motor excedeu o limite de recursos (~w) e foi encerrado de forma controlada', [Recurso]),
        nb_setval(staggy_limites, ['MEMORIA'])
    ;   Motivo = 'ERRO_INTERNO',
        Msg = 'Falha técnica interna do motor durante a resolução'
    ),
    message_to_codes_seguro(Erro, Detalhe),
    D = _{categoria:falha_tecnica, codigo:'FALHA_TECNICA_MOTOR', severidade:erro,
          etapa:resolucao, mensagem:Msg, entidades:_{}, natureza_evidencia:falha_tecnica,
          detalhe_tecnico:Detalhe},
    finalizar_erro(Motivo, [D]).

message_to_codes_seguro(Erro, Texto) :-
    catch(( format(string(T0), '~q', [Erro]),
            string_length(T0, L),
            (   L > 300 -> sub_string(T0, 0, 300, _, Texto) ; Texto = T0 ) ),
          _, Texto = "erro nao representavel").

% ---------------------------------------------------------------------------
% Validação estrutural do snapshot (CA-49, CA-121). O backend valida antes
% (RN-24); o motor repete as verificações por defesa em profundidade.
% ---------------------------------------------------------------------------

erro_entrada(Codigo, Mensagem, Entidades,
             _{categoria:entrada_invalida, codigo:Codigo, severidade:erro,
               etapa:pre_validacao_motor, mensagem:Mensagem, entidades:Entidades,
               natureza_evidencia:comprovada}).

validar_estrutura(S, Erros) :-
    (   \+ is_dict(S)
    ->  erro_entrada('JSON_INVALIDO', 'O snapshot não é um objeto JSON', _{}, E),
        Erros = [E]
    ;   findall(E, erro_estrutura(S, E), Es),
        list_to_set(Es, Erros)
    ).

campos_obrigatorios([schema_version, run_id, curso_id, periodo_letivo_id, form_version,
                     snapshot_hash, 'K', turnos, dias_letivos, blocos_por_dia_turno, turmas,
                     disciplinas, professores_participantes, travas, politica,
                     limite_execucao_segundos]).

% Identificador opaco: texto não vazio. "true", "false" e "null" são
% reservados porque o JSON de saída os confundiria com literais.
texto_valido(V) :-
    string(V),
    V \== "",
    \+ memberchk(V, ["true", "false", "null"]).

texto(D, Chave, Atomo) :-
    get_dict(Chave, D, S),
    string(S),
    atom_string(Atomo, S).

erro_estrutura(S, E) :-
    schema_snapshot(V),
    atom_string(V, VS),
    \+ get_dict(schema_version, S, VS),
    erro_entrada('SCHEMA_INCOMPATIVEL', 'schema_version do snapshot não é suportada pelo motor',
                 _{esperado:V}, E).
erro_estrutura(S, E) :-
    campos_obrigatorios(Cs),
    member(C, Cs),
    \+ get_dict(C, S, _),
    format(atom(M), 'Campo obrigatório ausente: ~w', [C]),
    erro_entrada('CAMPO_AUSENTE', M, _{campo:C}, E).
erro_estrutura(S, E) :-
    member(C, [run_id, curso_id, periodo_letivo_id, form_version, snapshot_hash]),
    get_dict(C, S, V),
    \+ texto_valido(V),
    format(atom(M), 'O campo ~w deve ser um texto não vazio', [C]),
    erro_entrada('IDENTIFICADOR_INVALIDO', M, _{campo:C}, E).
erro_estrutura(S, E) :-
    get_dict('K', S, K),
    \+ ( integer(K), K >= 1 ),
    erro_entrada('K_INVALIDO', 'K deve ser um inteiro positivo de aulas por bloco (RN-09)', _{campo:'K'}, E).
erro_estrutura(S, E) :-
    get_dict(limite_execucao_segundos, S, L),
    limite_maximo_segundos(Max),
    \+ ( integer(L), L >= 1, L =< Max ),
    erro_entrada('LIMITE_EXECUCAO_INVALIDO',
                 'limite_execucao_segundos deve ser inteiro entre 1 e 600 (RN-51)',
                 _{campo:limite_execucao_segundos}, E).
erro_estrutura(S, E) :-
    get_dict(politica, S, P),
    \+ politica_compativel(P),
    erro_entrada('POLITICA_INCOMPATIVEL',
                 'A política de preferências do snapshot difere da política homologada do motor (CP-02, CP-03, RN-67)',
                 _{campo:politica}, E).
erro_estrutura(S, E) :-
    member(C, [turnos, dias_letivos, blocos_por_dia_turno, turmas, disciplinas,
               professores_participantes, travas]),
    get_dict(C, S, V),
    \+ is_list(V),
    format(atom(M), 'O campo ~w deve ser uma lista', [C]),
    erro_entrada('TIPO_INVALIDO', M, _{campo:C}, E).
erro_estrutura(S, E) :-
    get_dict(turnos, S, Ts), is_list(Ts),
    member(T, Ts),
    \+ ( string(T), atom_string(A, T), turno_cod(A, _) ),
    erro_entrada('TURNO_INVALIDO', 'Turno fora da enumeração normativa (MANHA, TARDE, NOITE)', _{campo:turnos}, E).
erro_estrutura(S, E) :-
    get_dict(dias_letivos, S, Ds), is_list(Ds),
    member(D, Ds),
    \+ ( string(D), atom_string(A, D), dia_iso(A, _) ),
    erro_entrada('DIA_INVALIDO', 'Dia letivo fora da enumeração normativa', _{campo:dias_letivos}, E).
erro_estrutura(S, E) :-
    get_dict(blocos_por_dia_turno, S, Bs), is_list(Bs),
    member(B, Bs),
    \+ bloco_estrutura_valido(S, B),
    erro_entrada('BLOCOS_INVALIDOS',
                 'Cada item de blocos_por_dia_turno exige dia e turno letivos válidos e quantidade inteira positiva',
                 _{campo:blocos_por_dia_turno}, E).
erro_estrutura(S, E) :-
    get_dict(blocos_por_dia_turno, S, Bs), is_list(Bs),
    findall(D-T, ( member(B, Bs), is_dict(B), get_dict(dia, B, D), get_dict(turno, B, T) ), Pares),
    msort(Pares, Ordenados),
    append(_, [X, X|_], Ordenados),
    X = Dia-Turno,
    erro_entrada('BLOCOS_DUPLICADOS', 'Combinação dia/turno repetida em blocos_por_dia_turno',
                 _{dia:Dia, turno:Turno}, E).
erro_estrutura(S, E) :-
    member(Lista-Campos, [turmas-[id, semestre_id, turno],
                          disciplinas-[id, semestre_id, carga_aulas],
                          professores_participantes-[id, disciplinas_selecionadas_e_notas,
                                                      blocos_selecionados, notas_dia_turno],
                          travas-[id, tipo, origem_versao, alvo, valor_fixo]]),
    get_dict(Lista, S, Itens), is_list(Itens),
    member(Item, Itens),
    (   \+ is_dict(Item)
    ->  format(atom(M), 'Item de ~w não é um objeto', [Lista]),
        erro_entrada('TIPO_INVALIDO', M, _{campo:Lista}, E)
    ;   member(C, Campos),
        \+ get_dict(C, Item, _),
        format(atom(M), 'Campo ~w ausente em ~w', [C, Lista]),
        erro_entrada('CAMPO_AUSENTE', M, _{campo:C, lista:Lista}, E)
    ).
erro_estrutura(S, E) :-
    member(Lista, [turmas, disciplinas, professores_participantes, travas]),
    get_dict(Lista, S, Itens), is_list(Itens),
    member(Item, Itens), is_dict(Item),
    get_dict(id, Item, Id),
    \+ texto_valido(Id),
    format(atom(M), 'Identificador inválido em ~w', [Lista]),
    erro_entrada('IDENTIFICADOR_INVALIDO', M, _{campo:id, lista:Lista}, E).
erro_estrutura(S, E) :-
    member(Lista, [turmas, disciplinas, professores_participantes, travas]),
    get_dict(Lista, S, Itens), is_list(Itens),
    findall(Id, ( member(Item, Itens), is_dict(Item), get_dict(id, Item, Id) ), Ids),
    msort(Ids, Ordenados),
    append(_, [X, X|_], Ordenados),
    format(atom(M), 'Identificador repetido em ~w', [Lista]),
    erro_entrada('IDENTIFICADOR_DUPLICADO', M, _{lista:Lista, id:X}, E).
erro_estrutura(S, E) :-
    get_dict(turmas, S, Ts), is_list(Ts),
    member(T, Ts), is_dict(T),
    (   get_dict(semestre_id, T, Sem), \+ texto_valido(Sem)
    ->  Codigo = 'IDENTIFICADOR_INVALIDO', Msg = 'Turma com semestre_id inválido'
    ;   get_dict(turno, T, Tu), \+ ( string(Tu), atom_string(A, Tu), turno_cod(A, _) )
    ->  Codigo = 'TURNO_OBRIGATORIO', Msg = 'Turma sem turno válido (RN-05, CA-04)'
    ),
    ( get_dict(id, T, Id) -> true ; Id = null ),
    erro_entrada(Codigo, Msg, _{turma_id:Id}, E).
erro_estrutura(S, E) :-
    get_dict(disciplinas, S, Ds), is_list(Ds),
    member(D, Ds), is_dict(D),
    (   get_dict(semestre_id, D, Sem), \+ texto_valido(Sem)
    ->  Codigo = 'IDENTIFICADOR_INVALIDO', Msg = 'Disciplina com semestre_id inválido'
    ;   get_dict(carga_aulas, D, C), \+ ( integer(C), C >= 1 )
    ->  Codigo = 'CARGA_INVALIDA', Msg = 'carga_aulas deve ser inteiro positivo (RN-06)'
    ),
    ( get_dict(id, D, Id) -> true ; Id = null ),
    erro_entrada(Codigo, Msg, _{disciplina_id:Id}, E).
erro_estrutura(S, E) :-
    get_dict(professores_participantes, S, Ps), is_list(Ps),
    member(P, Ps), is_dict(P),
    ( get_dict(id, P, Id) -> true ; Id = null ),
    erro_professor_estrutura(P, Codigo, Msg),
    erro_entrada(Codigo, Msg, _{professor_id:Id}, E).
erro_estrutura(S, E) :-
    get_dict(travas, S, Ts), is_list(Ts),
    member(T, Ts), is_dict(T),
    ( get_dict(id, T, Id) -> true ; Id = null ),
    erro_trava_estrutura(T, Codigo, Msg),
    erro_entrada(Codigo, Msg, _{trava_id:Id}, E).

bloco_estrutura_valido(S, B) :-
    is_dict(B),
    get_dict(dia, B, D), string(D), atom_string(DA, D), dia_iso(DA, _),
    get_dict(turno, B, T), string(T), atom_string(TA, T), turno_cod(TA, _),
    get_dict(quantidade, B, Q), integer(Q), Q >= 1,
    get_dict(dias_letivos, S, Ds), is_list(Ds), memberchk(D, Ds),
    get_dict(turnos, S, Ts), is_list(Ts), memberchk(T, Ts).

nota_valida(N) :-
    integer(N), N >= 1, N =< 5.

coordenada_estrutura(C) :-
    is_dict(C),
    get_dict(dia, C, D), string(D),
    get_dict(turno, C, T), string(T),
    get_dict(indice, C, I), integer(I).

erro_professor_estrutura(P, Codigo, Msg) :-
    get_dict(disciplinas_selecionadas_e_notas, P, Ds),
    (   \+ is_list(Ds)
    ->  Codigo = 'TIPO_INVALIDO', Msg = 'disciplinas_selecionadas_e_notas deve ser lista'
    ;   member(D, Ds),
        \+ ( is_dict(D), get_dict(disciplina_id, D, Id), texto_valido(Id) ),
        Codigo = 'IDENTIFICADOR_INVALIDO', Msg = 'Seleção de disciplina sem disciplina_id válido'
    ;   member(D, Ds), is_dict(D),
        \+ ( get_dict(nota, D, N), nota_valida(N) ),
        Codigo = 'NOTA_INVALIDA', Msg = 'Nota de disciplina ausente ou fora do intervalo inteiro 1..5 (CA-28)'
    ).
erro_professor_estrutura(P, Codigo, Msg) :-
    get_dict(blocos_selecionados, P, Bs),
    (   \+ is_list(Bs)
    ->  Codigo = 'TIPO_INVALIDO', Msg = 'blocos_selecionados deve ser lista'
    ;   member(B, Bs), \+ coordenada_estrutura(B),
        Codigo = 'COORDENADA_INVALIDA', Msg = 'Bloco selecionado com coordenada malformada'
    ).
erro_professor_estrutura(P, Codigo, Msg) :-
    get_dict(notas_dia_turno, P, Ns),
    (   \+ is_list(Ns)
    ->  Codigo = 'TIPO_INVALIDO', Msg = 'notas_dia_turno deve ser lista'
    ;   member(N, Ns),
        \+ ( is_dict(N), get_dict(dia, N, D), string(D), get_dict(turno, N, T), string(T) ),
        Codigo = 'COORDENADA_INVALIDA', Msg = 'Nota de dia/turno sem dia e turno'
    ;   member(N, Ns), is_dict(N),
        \+ ( get_dict(nota, N, V), nota_valida(V) ),
        Codigo = 'NOTA_INVALIDA', Msg = 'Nota de dia/turno ausente ou fora do intervalo inteiro 1..5 (CA-28)'
    ).

erro_trava_estrutura(T, Codigo, Msg) :-
    get_dict(tipo, T, Tipo),
    \+ ( string(Tipo), atom_string(A, Tipo), tipo_trava(A) ),
    Codigo = 'TRAVA_INVALIDA', Msg = 'Tipo de trava desconhecido'.
erro_trava_estrutura(T, Codigo, Msg) :-
    get_dict(origem_versao, T, O),
    \+ texto_valido(O),
    Codigo = 'TRAVA_INVALIDA', Msg = 'Trava sem origem_versao (grade-base) identificável (RN-49)'.
erro_trava_estrutura(T, Codigo, Msg) :-
    get_dict(tipo, T, TipoS), string(TipoS), atom_string(Tipo, TipoS), tipo_trava(Tipo),
    get_dict(alvo, T, Alvo), get_dict(valor_fixo, T, Valor),
    \+ trava_campos(Tipo, Alvo, Valor),
    Codigo = 'TRAVA_INVALIDA', Msg = 'Campos de alvo/valor_fixo incompatíveis com o tipo da trava'.

trava_campos(ocupacao, A, V) :-
    coordenada_estrutura(A), get_dict(turma_id, A, T), texto_valido(T),
    is_dict(V), get_dict(disciplina_id, V, D), texto_valido(D),
    get_dict(professor_id, V, P), texto_valido(P).
trava_campos(vaga_turma, A, _) :-
    coordenada_estrutura(A), get_dict(turma_id, A, T), texto_valido(T).
trava_campos(vaga_professor, A, _) :-
    coordenada_estrutura(A), get_dict(professor_id, A, P), texto_valido(P).
trava_campos(fixacao_disciplina_professor, A, V) :-
    is_dict(A), get_dict(semestre_id, A, S), texto_valido(S),
    get_dict(disciplina_id, A, D), texto_valido(D),
    is_dict(V), get_dict(professor_id, V, P), texto_valido(P).

politica_compativel(P) :-
    is_dict(P),
    policy_version(V), atom_string(V, VS),
    get_dict(policy_version, P, VS),
    get_dict(phi, P, Phi), is_list(Phi), length(Phi, 5),
    forall(phi(N, F),
           ( member(X, Phi), is_dict(X), get_dict(nota, X, N), get_dict(penalidade, X, F) )),
    peso_dia_turno(P1), get_dict(peso_dia_turno, P, P1),
    peso_disciplina(P2), get_dict(peso_disciplina, P, P2),
    teto_aulas(Teto), get_dict(teto_aulas_professor, P, Teto),
    minimo_disciplinas(Min), get_dict(minimo_disciplinas_professor, P, Min).

% ---------------------------------------------------------------------------
% Carregamento da instância em fatos (IDs como átomos, coordenadas numeradas
% na ordem canônica dia ISO, turno, índice).
% ---------------------------------------------------------------------------

carregar_instancia(S) :-
    get_dict('K', S, K),
    assertz(i_k(K)),
    teto_aulas(Teto),
    Cap is Teto // K,
    assertz(i_cap(Cap)),
    texto(S, curso_id, Curso),
    assertz(i_meta(curso_id, Curso)),
    texto(S, periodo_letivo_id, Periodo),
    assertz(i_meta(periodo_letivo_id, Periodo)),
    get_dict(blocos_por_dia_turno, S, Bs),
    findall(k(DI, TC, Idx)-c(Dia, Turno, Idx),
            ( member(B, Bs),
              texto(B, dia, Dia), texto(B, turno, Turno), get_dict(quantidade, B, Q),
              dia_iso(Dia, DI), turno_cod(Turno, TC),
              between(1, Q, Idx) ),
            Pares0),
    keysort(Pares0, Pares),
    foldl(assert_coord, Pares, 1, _),
    get_dict(turmas, S, Ts),
    forall(member(T, Ts),
           ( texto(T, id, Id), texto(T, semestre_id, Sem), texto(T, turno, Turno),
             id_bytes(Id, By), assertz(i_turma(Id, Sem, Turno, By)) )),
    get_dict(disciplinas, S, Ds),
    forall(member(D, Ds),
           ( texto(D, id, Id), texto(D, semestre_id, Sem), get_dict(carga_aulas, D, C),
             id_bytes(Id, By), assertz(i_disc(Id, Sem, C, By)) )),
    get_dict(professores_participantes, S, Ps),
    forall(member(P, Ps), carregar_professor(P)),
    get_dict(travas, S, Trs),
    forall(member(Tr, Trs), carregar_trava(Tr)).

assert_coord(_-c(Dia, Turno, Idx), Ci, Ci1) :-
    assertz(i_coord(Ci, Dia, Turno, Idx)),
    Ci1 is Ci + 1.

coordenada(C, Ci) :-
    texto(C, dia, Dia),
    texto(C, turno, Turno),
    get_dict(indice, C, Idx),
    i_coord(Ci, Dia, Turno, Idx), !.

carregar_professor(P) :-
    texto(P, id, Id),
    id_bytes(Id, By),
    assertz(i_prof(Id, By)),
    get_dict(disciplinas_selecionadas_e_notas, P, Ds),
    forall(member(D, Ds),
           ( texto(D, disciplina_id, DId), get_dict(nota, D, N),
             (   i_sel_disc(Id, DId, _)
             ->  erro_entrada('SELECAO_DUPLICADA', 'Disciplina selecionada mais de uma vez',
                              _{professor_id:Id, disciplina_id:DId}, E),
                 assertz(i_erro(E))
             ;   assertz(i_sel_disc(Id, DId, N))
             ) )),
    get_dict(blocos_selecionados, P, Bs),
    forall(member(B, Bs),
           (   coordenada(B, Ci)
           ->  (   i_sel_bloco(Id, Ci)
               ->  true
               ;   assertz(i_sel_bloco(Id, Ci))
               )
           ;   get_dict(dia, B, Dia), get_dict(turno, B, Turno), get_dict(indice, B, Idx),
               erro_entrada('BLOCO_INEXISTENTE',
                            'Bloco selecionado não existe na estrutura ordinal do calendário (CA-11)',
                            _{professor_id:Id, dia:Dia, turno:Turno, indice:Idx}, E),
               assertz(i_erro(E))
           )),
    get_dict(notas_dia_turno, P, Ns),
    forall(member(N, Ns),
           ( texto(N, dia, Dia), texto(N, turno, Turno), get_dict(nota, N, V),
             (   i_nota_dt(Id, Dia, Turno, _)
             ->  erro_entrada('NOTA_DUPLICADA', 'Nota de dia/turno repetida',
                              _{professor_id:Id, dia:Dia, turno:Turno}, E),
                 assertz(i_erro(E))
             ;   \+ i_coord(_, Dia, Turno, _)
             ->  erro_entrada('DIA_TURNO_INEXISTENTE', 'Nota atribuída a dia/turno sem blocos letivos',
                              _{professor_id:Id, dia:Dia, turno:Turno}, E),
                 assertz(i_erro(E))
             ;   assertz(i_nota_dt(Id, Dia, Turno, V))
             ) )).

carregar_trava(Tr) :-
    texto(Tr, id, Id),
    texto(Tr, tipo, Tipo),
    assertz(i_trava(Id)),
    get_dict(alvo, Tr, A),
    get_dict(valor_fixo, Tr, V),
    carregar_trava(Tipo, Id, A, V).

carregar_trava(ocupacao, Id, A, V) :- !,
    texto(A, turma_id, T), texto(V, disciplina_id, D), texto(V, professor_id, P),
    (   coordenada(A, Ci)
    ->  assertz(i_ocup(Id, T, Ci, D, P))
    ;   trava_coordenada_inexistente(Id)
    ).
carregar_trava(vaga_turma, Id, A, _) :- !,
    texto(A, turma_id, T),
    (   coordenada(A, Ci)
    ->  assertz(i_vaga_turma(Id, T, Ci))
    ;   trava_coordenada_inexistente(Id)
    ).
carregar_trava(vaga_professor, Id, A, _) :- !,
    texto(A, professor_id, P),
    (   coordenada(A, Ci)
    ->  assertz(i_vaga_prof(Id, P, Ci))
    ;   trava_coordenada_inexistente(Id)
    ).
carregar_trava(fixacao_disciplina_professor, Id, A, V) :-
    texto(A, semestre_id, S), texto(A, disciplina_id, D), texto(V, professor_id, P),
    assertz(i_fix(Id, S, D, P)).

trava_coordenada_inexistente(Id) :-
    erro_entrada('TRAVA_INCOMPATIVEL',
                 'Trava referencia bloco inexistente na estrutura vigente; não é reinterpretada por índice (CA-122)',
                 _{trava_id:Id}, E),
    assertz(i_erro(E)).

% ---------------------------------------------------------------------------
% Validação semântica sobre os fatos (referências, cargas, notas, travas)
% ---------------------------------------------------------------------------

validar_semantica(Erros) :-
    findall(E, i_erro(E), E0),
    findall(E, erro_semantico(E), E1),
    append(E0, E1, Es),
    list_to_set(Es, Erros).

erro_semantico(E) :-
    i_k(K),
    i_disc(D, _, C, _),
    C mod K =\= 0,
    format(atom(M), 'Carga de ~w aulas não é múltipla de K=~w (RN-13, CA-16)', [C, K]),
    erro_entrada('CARGA_INCOMPATIVEL_COM_K', M, _{disciplina_id:D, carga_aulas:C, 'K':K}, E).
erro_semantico(E) :-
    i_turma(T, _, Turno, _),
    \+ i_coord(_, _, Turno, _),
    erro_entrada('TURNO_SEM_BLOCOS', 'O turno da turma não possui blocos letivos configurados (RN-05)',
                 _{turma_id:T, turno:Turno}, E).
erro_semantico(E) :-
    i_sel_disc(P, D, _),
    \+ i_disc(D, _, _, _),
    erro_entrada('DISCIPLINA_INEXISTENTE', 'Professor selecionou disciplina ausente do snapshot (CA-121)',
                 _{professor_id:P, disciplina_id:D}, E).
erro_semantico(E) :-
    % RN-17, RN-22, CA-26, CA-27: nota obrigatória para dia/turno com bloco selecionado
    i_prof(P, _),
    setof(Dia-Turno, Ci^Idx^( i_sel_bloco(P, Ci), i_coord(Ci, Dia, Turno, Idx) ), DTs),
    member(Dia-Turno, DTs),
    \+ i_nota_dt(P, Dia, Turno, _),
    erro_entrada('NOTA_DIA_TURNO_AUSENTE',
                 'Falta a nota de dia/turno para blocos selecionados; o motor não presume nota (CA-27)',
                 _{professor_id:P, dia:Dia, turno:Turno}, E).
erro_semantico(E) :-
    i_ocup(Id, T, Ci, D, P),
    erro_trava_ocupacao(T, Ci, D, P, Codigo, Msg),
    entidades_trava(Id, T, D, P, Ci, Ent),
    erro_entrada(Codigo, Msg, Ent, E).
erro_semantico(E) :-
    i_vaga_turma(Id, T, Ci),
    (   \+ i_turma(T, _, _, _)
    ->  Codigo = 'TRAVA_REFERENCIA_INEXISTENTE', Msg = 'Trava de vaga referencia turma inexistente'
    ;   i_turma(T, _, Turno, _), \+ i_coord(Ci, _, Turno, _)
    ->  Codigo = 'TRAVA_INCOMPATIVEL', Msg = 'Vaga bloqueada fora do turno da turma (RN-54)'
    ),
    entidades_trava(Id, T, null, null, Ci, Ent),
    erro_entrada(Codigo, Msg, Ent, E).
erro_semantico(E) :-
    i_vaga_prof(Id, P, Ci),
    \+ i_prof(P, _),
    entidades_trava(Id, null, null, P, Ci, Ent),
    erro_entrada('TRAVA_REFERENCIA_INEXISTENTE',
                 'Trava de vaga docente referencia professor fora dos participantes', Ent, E).
erro_semantico(E) :-
    i_fix(Id, S, D, P),
    (   \+ i_disc(D, S, _, _)
    ->  Codigo = 'TRAVA_REFERENCIA_INEXISTENTE', Msg = 'Fixação referencia disciplina inexistente no semestre'
    ;   \+ i_prof(P, _)
    ->  Codigo = 'TRAVA_REFERENCIA_INEXISTENTE', Msg = 'Fixação referencia professor fora dos participantes'
    ;   \+ i_sel_disc(P, D, _)
    ->  Codigo = 'TRAVA_INCOMPATIVEL', Msg = 'Fixação para professor que não selecionou a disciplina (RN-43, CA-105)'
    ),
    entidades_trava(Id, null, D, P, null, Ent0),
    put_dict(semestre_id, Ent0, S, Ent),
    erro_entrada(Codigo, Msg, Ent, E).
erro_semantico(E) :-
    % mesma posição de turma travada com conteúdos diferentes
    i_ocup(Id1, T, Ci, D1, P1), i_ocup(Id2, T, Ci, D2, P2),
    Id1 @< Id2, (D1 \== D2 ; P1 \== P2),
    travas_contraditorias(Id1, Id2, 'Duas travas fixam conteúdos diferentes na mesma posição da turma', E).
erro_semantico(E) :-
    i_ocup(Id1, T, Ci, _, _), i_vaga_turma(Id2, T, Ci),
    travas_contraditorias(Id1, Id2, 'Posição travada ao mesmo tempo como ocupada e como vaga', E).
erro_semantico(E) :-
    i_ocup(Id1, _, Ci, _, P), i_vaga_prof(Id2, P, Ci),
    travas_contraditorias(Id1, Id2, 'Professor travado em aula e em vaga na mesma coordenada', E).
erro_semantico(E) :-
    i_ocup(Id1, T1, Ci, _, P), i_ocup(Id2, T2, Ci, _, P),
    Id1 @< Id2, T1 \== T2,
    travas_contraditorias(Id1, Id2, 'Professor travado em duas turmas na mesma coordenada (RN-21)', E).
erro_semantico(E) :-
    i_ocup(Id1, T, _, D, P1), i_ocup(Id2, T, _, D, P2),
    Id1 @< Id2, P1 \== P2,
    travas_contraditorias(Id1, Id2, 'Travas atribuem professores diferentes à mesma turma–disciplina (RN-19)', E).
erro_semantico(E) :-
    i_fix(Id1, S, D, P1), i_fix(Id2, S, D, P2),
    Id1 @< Id2, P1 \== P2,
    travas_contraditorias(Id1, Id2, 'Fixações incompatíveis para a mesma disciplina do semestre (RN-43)', E).
erro_semantico(E) :-
    i_fix(Id1, S, D, P1), i_ocup(Id2, T, _, D, P2),
    i_turma(T, S, _, _), P1 \== P2,
    travas_contraditorias(Id1, Id2, 'Fixação disciplina–professor conflita com bloco travado de outro professor (CA-104)', E).
erro_semantico(E) :-
    i_k(K),
    i_turma(T, _, _, _), i_disc(D, _, C, _),
    R is C // K,
    aggregate_all(count, i_ocup(_, T, _, D, _), N),
    N > R,
    format(atom(M), 'Há ~w blocos travados para uma obrigação de ~w blocos (RN-08)', [N, R]),
    erro_entrada('TRAVAS_EXCEDEM_CARGA', M, _{turma_id:T, disciplina_id:D}, E).
erro_semantico(E) :-
    i_k(K), teto_aulas(Teto),
    i_prof(P, _),
    aggregate_all(count, i_ocup(_, _, _, _, P), N),
    N * K > Teto,
    format(atom(M), 'Travas atribuem ~w aulas ao professor, acima do teto de ~w (RN-20)', [N*K, Teto]),
    erro_entrada('TRAVAS_EXCEDEM_TETO', M, _{professor_id:P}, E).

erro_trava_ocupacao(T, _, _, _, 'TRAVA_REFERENCIA_INEXISTENTE', 'Trava referencia turma inexistente') :-
    \+ i_turma(T, _, _, _), !.
erro_trava_ocupacao(_, _, D, _, 'TRAVA_REFERENCIA_INEXISTENTE', 'Trava referencia disciplina inexistente') :-
    \+ i_disc(D, _, _, _), !.
erro_trava_ocupacao(_, _, _, P, 'TRAVA_REFERENCIA_INEXISTENTE', 'Trava referencia professor fora dos participantes') :-
    \+ i_prof(P, _), !.
erro_trava_ocupacao(T, _, D, _, 'TRAVA_INCOMPATIVEL', 'Disciplina travada não pertence ao semestre da turma') :-
    i_turma(T, S, _, _), \+ i_disc(D, S, _, _), !.
erro_trava_ocupacao(T, Ci, _, _, 'TRAVA_INCOMPATIVEL', 'Bloco travado fora do turno da turma (RN-05)') :-
    i_turma(T, _, Turno, _), \+ i_coord(Ci, _, Turno, _), !.
erro_trava_ocupacao(_, _, D, P, 'TRAVA_INCOMPATIVEL', 'Professor travado em disciplina que não selecionou (RN-15, CA-105)') :-
    \+ i_sel_disc(P, D, _), !.
erro_trava_ocupacao(_, Ci, _, P, 'TRAVA_INCOMPATIVEL', 'Professor travado em bloco que não selecionou (RN-16)') :-
    \+ i_sel_bloco(P, Ci), !.

entidades_trava(Id, T, D, P, Ci, Ent) :-
    Ent0 = _{trava_id:Id},
    ( T \== null -> put_dict(turma_id, Ent0, T, Ent1) ; Ent1 = Ent0 ),
    ( D \== null -> put_dict(disciplina_id, Ent1, D, Ent2) ; Ent2 = Ent1 ),
    ( P \== null -> put_dict(professor_id, Ent2, P, Ent3) ; Ent3 = Ent2 ),
    (   Ci \== null, i_coord(Ci, Dia, Turno, Idx)
    ->  put_dict(_{dia:Dia, turno:Turno, indice:Idx}, Ent3, Ent)
    ;   Ent = Ent3
    ).

travas_contraditorias(Id1, Id2, Msg, E) :-
    erro_entrada('TRAVAS_CONTRADITORIAS', Msg, _{travas:[Id1, Id2]}, E).

% ---------------------------------------------------------------------------
% Construção do modelo
%   ob(Oi, TurmaId, DisciplinaId, R, Tps, Grau, Forcado)
%   tp(ProfessorId, Y, Ws, NB, Gs)   candidato p da obrigação o
%   w(Ci, W, Custo, CustoDiaTurno, CustoDisciplina)  (Ws ordenados por custo, Ci)
%   g(dt(DiaIso, TurnoCod), Custo, N, WVs)  N = blocos de o com p no dia/turno;
%                                    o custo depende só de (p, d, dia/turno)
%   pr(ProfessorId, NB, Cp, Ys, Gs)  agregados do professor
%   pos(TurmaId, Ci, V, Ligacoes)    posições na ordem canônica
% ---------------------------------------------------------------------------

turmas_canonicas(Ts) :-
    findall(B-t(T, S, Turno), i_turma(T, S, Turno, B), Ps),
    keysort(Ps, Ord),
    pairs_values(Ord, Ts).

disciplinas_do_semestre(S, Ds) :-
    findall(B-d(D, C), i_disc(D, S, C, B), Ps),
    keysort(Ps, Ord),
    pairs_values(Ord, Ds).

professores_canonicos(Ps) :-
    findall(B-P, i_prof(P, B), Pares),
    keysort(Pares, Ord),
    pairs_values(Ord, Ps).

dt_de(Ci, dt(DI, TC)) :-
    i_coord(Ci, Dia, Turno, _),
    dia_iso(Dia, DI),
    turno_cod(Turno, TC).

construir_modelo(modelo(Obs, Profs, C, Posicoes, Vars, WsPorDT)) :-
    i_k(K),
    turmas_canonicas(Turmas),
    professores_canonicos(PIds),
    postos(Postos),
    nb_setval(staggy_postos, Postos),
    findall(P-_NB, member(P, PIds), NBPares),
    list_to_assoc(NBPares, NBs),
    findall(o(T, S, Turno, D, R),
            ( member(t(T, S, Turno), Turmas),
              disciplinas_do_semestre(S, Ds),
              member(d(D, Carga), Ds),
              R is Carga // K ),
            Os0),
    foldl(construir_ob(K, PIds, NBs), Os0, Obs0, 1, _),
    graus(Obs0, Obs),
    construir_posicoes(Turmas, Obs, Postos, Posicoes),
    foldl(acumular_prof, Obs, [], ProfPares0),
    keysort(ProfPares0, ProfPares),
    group_pairs_by_key(ProfPares, PorProf),
    maplist(construir_pr(NBs, PorProf), PIds, Profs),
    foldl(vars_ob, Obs, [], Vars0),
    foldl(vars_pos, Posicoes, Vars0, Vars),
    foldl(ws_dt_ob, Obs, [], DTPares0),
    keysort(DTPares0, DTPares),
    group_pairs_by_key(DTPares, WsPorDT),
    var(C).

% posto(d,p): ordem dos pares (bytes da disciplina, bytes do professor), a
% partir de 1; o valor 0 de V representa vaga e precede qualquer ocupação.
postos(Postos) :-
    findall(k(DB, PB)-(D-P), ( i_sel_disc(P, D, _), i_disc(D, _, _, DB), i_prof(P, PB) ), Pares0),
    keysort(Pares0, Pares),
    pairs_values(Pares, DPs),
    foldl(numerar_posto, DPs, Numerados, 1, _),
    list_to_assoc(Numerados, Postos).

numerar_posto(DP, DP-N, N, N1) :-
    N1 is N + 1.

construir_ob(K, PIds, NBs, o(T, S, Turno, D, R), ob(Oi, T, D, R, Tps, 0, Forcado), Oi, Oi1) :-
    Oi1 is Oi + 1,
    posicoes_da_obrigacao(T, Turno, D, Pos),
    permitidos(T, S, D, PIds, Permitidos, Forcado),
    findall(P-Ws,
            ( member(P, Permitidos),
              i_sel_disc(P, D, NotaD),
              ws_professor(K, P, T, D, NotaD, Pos, Ws),
              length(Ws, L), L >= R ),
            Cands),
    maplist(tp_de(NBs), Cands, Tps).

tp_de(NBs, P-Ws0, tp(P, _Y, Ws, NB, Gs)) :-
    get_assoc(P, NBs, NB),
    maplist(w_com_var, Ws0, Ws),
    maplist(w_chave_dt, Ws, Pares0),
    keysort(Pares0, Pares),
    group_pairs_by_key(Pares, Grupos),
    maplist(grupo_g, Grupos, Gs).

w_com_var(w(Ci, Custo, CDT, CD), w(Ci, _W, Custo, CDT, CD)).

w_chave_dt(w(Ci, W, Custo, _, _), k(Custo, DT)-W) :-
    dt_de(Ci, DT).

grupo_g(k(Custo, DT)-WVs, g(DT, Custo, _N, WVs)).

% Posições da turma no turno, sem vagas travadas e sem posições travadas
% para outra disciplina.
posicoes_da_obrigacao(T, Turno, D, Pos) :-
    findall(Ci,
            ( i_coord(Ci, _, Turno, _),
              \+ i_vaga_turma(_, T, Ci),
              \+ ( i_ocup(_, T, Ci, D2, _), D2 \== D ) ),
            Pos).

% Fixação semestral e blocos travados restringem o responsável (RN-43, RN-44).
permitidos(T, S, D, PIds, Permitidos, Forcado) :-
    findall(P, i_fix(_, S, D, P), Fix),
    findall(P, i_ocup(_, T, _, D, P), Oc),
    append(Fix, Oc, Forc0),
    sort(Forc0, Forc),
    (   Forc == []
    ->  Permitidos = PIds, Forcado = livre
    ;   Forc = [P]
    ->  Permitidos = [P], Forcado = forcado(P)
    ;   Permitidos = [], Forcado = conflito(Forc)
    ).

ws_professor(K, P, T, D, NotaD, Pos, Ws) :-
    findall(k(Custo, Ci)-w(Ci, Custo, CDT, CD),
            ( member(Ci, Pos),
              i_sel_bloco(P, Ci),
              \+ i_vaga_prof(_, P, Ci),
              \+ ( i_ocup(_, T2, Ci, D2, P), (T2 \== T ; D2 \== D) ),
              i_coord(Ci, Dia, Turno, _),
              i_nota_dt(P, Dia, Turno, NotaDT),
              custo_bloco(K, NotaDT, NotaD, Custo),
              phi(NotaDT, F1), peso_dia_turno(P1), CDT is K*P1*F1,
              phi(NotaD, F2), peso_disciplina(P2), CD is K*P2*F2 ),
            Pares),
    keysort(Pares, Ord),
    pairs_values(Ord, Ws).

% Grau de concorrência (estático): quantas outras obrigações disputam os
% mesmos candidatos. Usado só como desempate da escassez (RN-25, CA-37).
graus(Obs0, Obs) :-
    findall(P, ( member(ob(_, _, _, _, Tps, _, _), Obs0), member(tp(P, _, _, _, _), Tps) ), Ps0),
    msort(Ps0, Ps),
    clumped(Ps, Contagens),
    list_to_assoc(Contagens, A),
    maplist(grau_ob(A), Obs0, Obs).

grau_ob(A, ob(Oi, T, D, R, Tps, _, F), ob(Oi, T, D, R, Tps, G, F)) :-
    foldl(grau_tp(A), Tps, 0, G).

grau_tp(A, tp(P, _, _, _, _), G0, G) :-
    get_assoc(P, A, N),
    G is G0 + N - 1.

construir_posicoes(Turmas, Obs, Postos, Posicoes) :-
    foldl(pares_posicao(Postos), Obs, [], Pares0),
    keysort(Pares0, Pares),
    group_pairs_by_key(Pares, Grupos),
    list_to_assoc(Grupos, PorPos),
    findall(k(Ci, B)-(T-Ci),
            ( member(t(T, _, Turno), Turmas),
              i_turma(T, _, _, B),
              i_coord(Ci, _, Turno, _),
              \+ i_vaga_turma(_, T, Ci) ),
            Chaves0),
    keysort(Chaves0, Chaves),
    pairs_values(Chaves, TCs),
    maplist(posicao(PorPos), TCs, Posicoes).

pares_posicao(Postos, ob(_, T, D, _, Tps, _, _), Acc0, Acc) :-
    foldl(pares_posicao_tp(Postos, T, D), Tps, Acc0, Acc).

pares_posicao_tp(Postos, T, D, tp(P, _, Ws, _, _), Acc0, Acc) :-
    get_assoc(D-P, Postos, Posto),
    foldl(par_posicao(T, Posto), Ws, Acc0, Acc).

par_posicao(T, Posto, w(Ci, W, _, _, _), Acc, [(T-Ci)-(W-Posto)|Acc]).

posicao(PorPos, T-Ci, pos(T, Ci, _V, Ligacoes)) :-
    (   get_assoc(T-Ci, PorPos, Ligacoes)
    ->  true
    ;   Ligacoes = []
    ).

acumular_prof(ob(_, _, _, _, Tps, _, _), Acc0, Acc) :-
    foldl(acumular_tp, Tps, Acc0, Acc).

acumular_tp(tp(P, Y, _, _, Gs), Acc0, [P-y(Y)|Acc1]) :-
    foldl(acumular_g(P), Gs, Acc0, Acc1).

acumular_g(P, G, Acc, [P-G|Acc]).

construir_pr(NBs, PorProf, P, pr(P, NB, _Cp, Ys, Gs)) :-
    get_assoc(P, NBs, NB),
    (   memberchk(P-Itens, PorProf)
    ->  true
    ;   Itens = []
    ),
    partition(eh_y, Itens, YItens, Gs),
    maplist(y_var, YItens, Ys).

eh_y(y(_)).
y_var(y(Y), Y).

vars_ob(ob(_, _, _, _, Tps, _, _), Acc0, Acc) :-
    foldl(vars_tp, Tps, Acc0, Acc).

vars_tp(tp(_, Y, Ws, _, _), Acc0, [Y|Acc]) :-
    foldl(vars_w, Ws, Acc0, Acc).

vars_w(w(_, W, _, _, _), Acc, [W|Acc]).

vars_pos(pos(_, _, V, _), Acc, [V|Acc]).

ws_dt_ob(ob(_, _, _, _, Tps, _, _), Acc0, Acc) :-
    foldl(ws_dt_tp, Tps, Acc0, Acc).

ws_dt_tp(tp(_, _, _, _, Gs), Acc0, Acc) :-
    foldl(ws_dt_g, Gs, Acc0, Acc).

ws_dt_g(G, Acc, [DT-G|Acc]) :-
    G = g(DT, _, _, _).

% ---------------------------------------------------------------------------
% Prechecagens conclusivas (INVIAVEL_COMPROVADA sem busca) — RN-13, RN-24
% ---------------------------------------------------------------------------

diag_inviavel(Codigo, Mensagem, Entidades,
              _{categoria:inviabilidade, codigo:Codigo, severidade:erro, etapa:prechecagem,
                mensagem:Mensagem, entidades:Entidades, natureza_evidencia:comprovada}).

prechecar(modelo(Obs, Profs, _, Posicoes, _, _), Diags) :-
    findall(D, inviab_obrigacao(Obs, D), D1),
    findall(D, inviab_capacidade_turma(Obs, Posicoes, D), D2),
    findall(D, inviab_professor(Profs, D), D3),
    findall(D, inviab_carga_forcada(Obs, D), D4),
    (   D1 == [], D3 == []
    ->  cobertura_raiz(Obs, Profs, D5)
    ;   D5 = []
    ),
    append([D1, D2, D3, D4, D5], Diags).

inviab_obrigacao(Obs, D) :-
    member(ob(_, T, Disc, R, [], _, Forcado), Obs),
    (   Forcado = conflito(Ps)
    ->  diag_inviavel('TRAVAS_RESPONSAVEL_CONFLITANTES',
                      'Travas exigem professores diferentes para a mesma turma–disciplina',
                      _{turma_id:T, disciplina_id:Disc, professores:Ps}, D)
    ;   Forcado = forcado(P)
    ->  format(atom(M), 'O professor fixado/travado não dispõe de ~w blocos compatíveis livres na turma (CA-102)', [R]),
        diag_inviavel('FIXACAO_SEM_CAPACIDADE', M, _{turma_id:T, disciplina_id:Disc, professor_id:P, blocos_exigidos:R}, D)
    ;   \+ i_sel_disc(_, Disc, _)
    ->  diag_inviavel('DISCIPLINA_SEM_DOCENTE_ELEGIVEL',
                      'Nenhum professor participante selecionou a disciplina (CA-50)',
                      _{turma_id:T, disciplina_id:Disc}, D)
    ;   format(atom(M), 'Nenhum professor que selecionou a disciplina tem ~w blocos selecionados compatíveis com o turno e as travas da turma (CA-23)', [R]),
        diag_inviavel('DISPONIBILIDADE_INSUFICIENTE', M, _{turma_id:T, disciplina_id:Disc, blocos_exigidos:R}, D)
    ).

inviab_capacidade_turma(Obs, Posicoes, D) :-
    i_turma(T, _, _, _),
    aggregate_all(sum(R), member(ob(_, T, _, R, _, _, _), Obs), Exigidos),
    aggregate_all(count, member(pos(T, _, _, _), Posicoes), Livres),
    Exigidos > Livres,
    i_k(K),
    Aulas is Exigidos * K,
    format(atom(M), 'A turma exige ~w blocos (~w aulas) e dispõe de ~w blocos no turno (RN-13, CA-17)',
           [Exigidos, Aulas, Livres]),
    diag_inviavel('CAPACIDADE_TURMA_INSUFICIENTE', M, _{turma_id:T, blocos_exigidos:Exigidos, blocos_disponiveis:Livres}, D).

inviab_professor(Profs, D) :-
    member(pr(P, _, _, [], _), Profs),
    diag_inviavel('PROFESSOR_SEM_ATRIBUICAO_POSSIVEL',
                  'Professor participante não tem nenhuma obrigação possível; o mínimo de uma disciplina é inatingível (RN-20, CA-32)',
                  _{professor_id:P}, D).

inviab_carga_forcada(Obs, D) :-
    i_prof(P, _),
    aggregate_all(sum(R), member(ob(_, _, _, R, _, _, forcado(P)), Obs), Blocos),
    i_k(K), teto_aulas(Teto),
    Aulas is Blocos * K,
    Aulas > Teto,
    format(atom(M), 'Fixações e travas exigem ~w aulas do professor, acima do teto de ~w (CA-106)', [Aulas, Teto]),
    diag_inviavel('CARGA_FIXADA_EXCEDE_TETO', M, _{professor_id:P, aulas:Aulas}, D).

% Hall: cada participante precisa de uma obrigação distinta (cada obrigação
% tem um único responsável). Sem emparelhamento que cubra todos, não há grade.
cobertura_raiz(Obs, Profs, Diags) :-
    findall(P-Oi, ( member(ob(Oi, _, _, _, Tps, _, _), Obs), member(tp(P, _, _, _, _), Tps) ), Arestas),
    adjacencia(Arestas, Adj),
    findall(P, member(pr(P, _, _, _, _), Profs), Us),
    emparelhar(Us, Adj, NaoCobertos),
    (   NaoCobertos == []
    ->  Diags = []
    ;   length(Us, NP), length(Obs, NO),
        format(atom(M), 'Não existe atribuição de uma obrigação distinta a cada um dos ~w participantes (~w obrigações); o mínimo docente é inatingível (RN-20, RN-37)', [NP, NO]),
        diag_inviavel('COBERTURA_DOCENTE_IMPOSSIVEL', M, _{professores_sem_cobertura:NaoCobertos}, D),
        Diags = [D]
    ).

adjacencia(Arestas, Adj) :-
    msort(Arestas, Ord),
    group_pairs_by_key(Ord, Grupos),
    list_to_assoc(Grupos, Adj).

% Emparelhamento bipartido (Kuhn) com marcação de visitados por aumento.
emparelhar(Us, Adj, NaoCobertos) :-
    empty_assoc(M0),
    emparelhar_(Us, Adj, M0, [], NaoCobertos0),
    reverse(NaoCobertos0, NaoCobertos).

emparelhar_([], _, _, NC, NC).
emparelhar_([U|Us], Adj, M0, NC0, NC) :-
    empty_assoc(V0),
    aumentar(U, Adj, M0, V0, _, R),
    (   R = ok(M1)
    ->  emparelhar_(Us, Adj, M1, NC0, NC)
    ;   emparelhar_(Us, Adj, M0, [U|NC0], NC)
    ).

aumentar(U, Adj, M0, V0, V, R) :-
    (   get_assoc(U, Adj, Os)
    ->  true
    ;   Os = []
    ),
    aumentar_os(Os, U, Adj, M0, V0, V, R).

aumentar_os([], _, _, _, V, V, falhou).
aumentar_os([O|Os], U, Adj, M0, V0, V, R) :-
    (   get_assoc(O, V0, _)
    ->  aumentar_os(Os, U, Adj, M0, V0, V, R)
    ;   put_assoc(O, V0, t, V1),
        (   get_assoc(O, M0, U2)
        ->  aumentar(U2, Adj, M0, V1, V2, R2),
            (   R2 = ok(M2)
            ->  put_assoc(O, M2, U, M3),
                V = V2,
                R = ok(M3)
            ;   aumentar_os(Os, U, Adj, M0, V2, V, R)
            )
        ;   put_assoc(O, M0, U, M1),
            V = V1,
            R = ok(M1)
        )
    ).

% ---------------------------------------------------------------------------
% Restrições CLP(FD)  (postadas com maplist; forall/2 desfaria as ligações)
% ---------------------------------------------------------------------------

postar_restricoes(modelo(Obs, Profs, C, Posicoes, _, WsPorDT)) :-
    maplist(postar_ob, Obs),
    maplist(postar_posicao, Posicoes),
    postar_conflitos_professor(Obs),
    maplist(postar_prof, Profs, Cps),
    sum(Cps, #=, C),
    postar_capacidade_turma_dt(Obs, Posicoes),
    postar_capacidade_professor_dt(Profs),
    postar_contagem_coordenadas(Obs, Posicoes, WsPorDT),
    aplicar_travas_ocupacao(Obs).

% Contagem por coordenada (redundante, implicada pelas restrições de posição):
% X_c = aulas na coordenada c em todas as turmas ≤ min(professores que podem
% estar em c, turmas com posição livre em c); Σ_{c∈dt} X_c = Σ N do dia/turno
% e Σ_c X_c = Σ r(o). Dá à propagação o argumento de contagem ("casa dos
% pombos") que as restrições locais não enxergam.
postar_contagem_coordenadas(Obs, Posicoes, WsPorDT) :-
    foldl(pares_coord_ob, Obs, [], Pares0),
    keysort(Pares0, Pares),
    group_pairs_by_key(Pares, PorCoord),
    findall(Ci-T, member(pos(T, Ci, _, _), Posicoes), PT0),
    msort(PT0, PT),
    group_pairs_by_key(PT, TurmasPorCoord0),
    list_to_assoc(TurmasPorCoord0, TurmasPorCoord),
    maplist(contagem_coordenada(TurmasPorCoord), PorCoord, CoordXs),
    pairs_values(CoordXs, Xs),
    aggregate_all(sum(R), member(ob(_, _, _, R, _, _, _), Obs), Total),
    sum(Xs, #=, Total),
    maplist(contagem_dt(CoordXs), WsPorDT).

pares_coord_ob(ob(_, _, _, _, Tps, _, _), Acc0, Acc) :-
    foldl(pares_coord_tp, Tps, Acc0, Acc).

pares_coord_tp(tp(P, _, Ws, _, _), Acc0, Acc) :-
    foldl(par_coord(P), Ws, Acc0, Acc).

par_coord(P, w(Ci, W, _, _, _), Acc, [Ci-(P-W)|Acc]).

contagem_coordenada(TurmasPorCoord, Ci-PWs, Ci-X) :-
    pairs_keys(PWs, Ps0),
    sort(Ps0, Ps),
    length(Ps, NP),
    (   get_assoc(Ci, TurmasPorCoord, Ts) -> length(Ts, NT) ; NT = 0 ),
    Cap is min(NP, NT),
    pairs_values(PWs, Ws),
    sum(Ws, #=, X),
    X #=< Cap.

contagem_dt(CoordXs, DT-Gs) :-
    include(coord_no_dt(DT), CoordXs, Doc),
    pairs_values(Doc, Xs),
    maplist(g_n, Gs, Ns),
    sum(Xs, #=, S),
    sum(Ns, #=, S).

coord_no_dt(DT, Ci-_) :-
    dt_de(Ci, DT).

postar_ob(ob(_, _, _, R, Tps, _, _)) :-
    maplist(tp_y, Tps, Ys),
    Ys ins 0..1,
    sum(Ys, #=, 1),
    maplist(postar_tp(R), Tps).

tp_y(tp(_, Y, _, _, _), Y).

% Σ W do grupo = N; Σ N = r(o)·Y(o,p) (carga exata, RN-08; responsável único, RN-19)
postar_tp(R, tp(_, Y, _, _, Gs)) :-
    maplist(postar_grupo, Gs, Ns),
    sum(Ns, #=, R*Y).

postar_grupo(g(_, _, N, WVs), N) :-
    WVs ins 0..1,
    length(WVs, L),
    N in 0..L,
    sum(WVs, #=, N).

% Canalização W ↔ (V = posto): no máximo uma aula por posição da turma
% (RN-21, CA-35) e conteúdo canônico para o desempate (ET-13).
postar_posicao(pos(_, _, V, Ligacoes)) :-
    pairs_values(Ligacoes, Postos),
    list_to_fdset([0|Postos], Dom),
    V in_set Dom,
    maplist(canalizar(V), Ligacoes).

canalizar(V, W-Posto) :-
    W #<==> (V #= Posto).

% Um professor não atua em duas turmas na mesma coordenada (RN-21, CA-34).
postar_conflitos_professor(Obs) :-
    foldl(pares_prof_coord, Obs, [], Pares0),
    keysort(Pares0, Pares),
    group_pairs_by_key(Pares, Grupos),
    pairs_values(Grupos, Listas),
    include(com_dois_ou_mais, Listas, Conflitantes),
    maplist(no_maximo_um, Conflitantes).

com_dois_ou_mais([_, _|_]).

no_maximo_um(Ws) :-
    sum(Ws, #=<, 1).

pares_prof_coord(ob(_, _, _, _, Tps, _, _), Acc0, Acc) :-
    foldl(pares_prof_coord_tp, Tps, Acc0, Acc).

pares_prof_coord_tp(tp(P, _, Ws, _, _), Acc0, Acc) :-
    foldl(par_prof_coord(P), Ws, Acc0, Acc).

par_prof_coord(P, w(Ci, W, _, _, _), Acc, [(P-Ci)-W|Acc]).

% Teto de 40 aulas, mínimo de uma disciplina e custos por professor
% (RN-20, CP-08), sobre as contagens por dia/turno.
postar_prof(pr(_, NB, Cp, Ys, Gs), Cp) :-
    i_cap(Cap),
    maplist(g_n, Gs, Ns),
    maplist(g_custo, Gs, Custos),
    sum(Ns, #=, NB),
    NB #=< Cap,
    scalar_product(Custos, Ns, #=, Cp),
    minimo_disciplinas(Min),
    sum(Ys, #>=, Min).

g_n(g(_, _, N, _), N).
g_custo(g(_, C, _, _), C).

% Restrições redundantes (implicadas pelas de posição) que fortalecem a
% propagação no nível das contagens: blocos de uma turma num dia/turno não
% excedem suas posições livres; blocos de um professor num dia/turno não
% excedem as coordenadas que ele pode ocupar ali.
postar_capacidade_turma_dt(Obs, Posicoes) :-
    foldl(pares_turma_dt, Obs, [], Pares0),
    keysort(Pares0, Pares),
    group_pairs_by_key(Pares, Grupos),
    findall((T-DT)-1, ( member(pos(T, Ci, _, _), Posicoes), dt_de(Ci, DT) ), Uns),
    msort(Uns, UnsOrd),
    group_pairs_by_key(UnsOrd, Cap0),
    maplist(contar_valores, Cap0, Cap),
    list_to_assoc(Cap, CapA),
    maplist(limitar_grupo(CapA), Grupos).

pares_turma_dt(ob(_, T, _, _, Tps, _, _), Acc0, Acc) :-
    foldl(pares_turma_dt_tp(T), Tps, Acc0, Acc).

pares_turma_dt_tp(T, tp(_, _, _, _, Gs), Acc0, Acc) :-
    foldl(par_turma_dt(T), Gs, Acc0, Acc).

par_turma_dt(T, g(DT, _, N, _), Acc, [(T-DT)-N|Acc]).

contar_valores(K-Vs, K-N) :-
    length(Vs, N).

limitar_grupo(CapA, Chave-Ns) :-
    get_assoc(Chave, CapA, Cap),
    sum(Ns, #=<, Cap).

postar_capacidade_professor_dt(Profs) :-
    maplist(capacidade_professor_dt, Profs).

capacidade_professor_dt(pr(P, _, _, _, Gs)) :-
    maplist(g_dt_par, Gs, Pares0),
    keysort(Pares0, Pares),
    group_pairs_by_key(Pares, Grupos),
    maplist(limitar_professor_dt(P), Grupos).

g_dt_par(g(DT, _, N, _), DT-N).

% Coordenadas do dia/turno que o professor selecionou e que não estão travadas
% como vaga docente: limite superior válido para os seus blocos ali.
limitar_professor_dt(P, DT-Ns) :-
    aggregate_all(count,
                  ( i_sel_bloco(P, Ci), dt_de(Ci, DT), \+ i_vaga_prof(_, P, Ci) ),
                  Cap),
    sum(Ns, #=<, Cap).



aplicar_travas_ocupacao(Obs) :-
    findall(t(T, Ci, D, P), i_ocup(_, T, Ci, D, P), Travas),
    maplist(aplicar_ocupacao(Obs), Travas).

aplicar_ocupacao(Obs, t(T, Ci, D, P)) :-
    once(( member(ob(_, T, D, _, Tps, _, _), Obs),
           member(tp(P, Y, Ws, _, _), Tps),
           member(w(Ci, W, _, _, _), Ws) )),
    Y #= 1,
    W #= 1.

% ---------------------------------------------------------------------------
% Busca (RN-25, RN-65, ET-04, ET-15), em duas fases:
%  1. decisões sobre o responsável Y(o,p) e as contagens N(o,p,dia/turno) —
%     custo e equidade dependem só delas; escolha da obrigação pela menor
%     escassez E(o); poda só por limite inferior de relaxação, cobertura
%     docente (Hall) e escassez nula;
%  2. com todas as contagens fixadas, as posições de cada dia/turno são
%     independentes entre si e não alteram custo nem equidade: basta uma
%     colocação viável por dia/turno (once). Se algum dia/turno não admite
%     colocação, a folha falha e a busca retrocede nas contagens.
% ---------------------------------------------------------------------------

buscar(M, Modo) :-
    contar(staggy_nos),
    M = modelo(Obs, Profs, C, _, Vars, WsPorDT),
    aplicar_limite_superior(Modo, C),
    analisar(Obs, Analise),
    (   Analise = completo
    ->  colocar(WsPorDT),
        label(Vars)
    ;   Analise = parcial(Escolha, LB0, Incs),
        include(sem_atribuicao, Profs, SemObrigacao),
        extra_cobertura(SemObrigacao, Incs, Extra),
        LB is LB0 + Extra,
        verificar_limite_inferior(C, LB),
        verificar_cobertura(SemObrigacao, Incs),
        rastrear(Escolha),
        ramificar(Escolha, WsPorDT),
        buscar(M, Modo)
    ).

% WsPorDT: DT-Grupos — todos os grupos g/4 de todas as obrigações num dia/turno.
colocar(WsPorDT) :-
    maplist(colocar_dt, WsPorDT).

colocar_dt(_-Gs) :-
    foldl(ws_do_grupo, Gs, [], Ws),
    (   once(labeling([ff], Ws))
    ->  true
    ;   contar(staggy_podas_colocacao),
        fail
    ).

ws_do_grupo(g(_, _, _, WVs), Acc, Ws) :-
    append(WVs, Acc, Ws).

% Verificação incremental (só testa, não deixa ligações): o dia/turno cuja
% contagem acabou de ser fixada ainda admite colocar os blocos comprometidos?
% Rotula apenas as W de grupos com blocos comprometidos (inf N > 0); as
% demais podem ficar em 0. Poda sólida: sem colocação ali, nenhuma
% completação existe.
checar_dt(WsPorDT, DT) :-
    memberchk(DT-Gs, WsPorDT),
    foldl(ws_comprometidas, Gs, [], Ws),
    (   \+ \+ once(labeling([ff], Ws))
    ->  true
    ;   contar(staggy_podas_colocacao),
        fail
    ).

ws_comprometidas(g(_, _, N, WVs), Acc, Ws) :-
    (   ( integer(N) -> N > 0 ; fd_inf(N, I), I > 0 )
    ->  append(WVs, Acc, Ws)
    ;   Ws = Acc
    ).

aplicar_limite_superior(custo, C) :- !,
    nb_getval(staggy_ub, UB),
    (   UB == inf
    ->  true
    ;   C #=< UB
    ).
aplicar_limite_superior(_, _).

analisar(Obs, Analise) :-
    analisar_obs(Obs, 0, Fixo, [], Incs),
    (   Incs == []
    ->  Analise = completo
    ;   melhor_inc(Incs, Escolha),
        foldl(somar_lb, Incs, Fixo, LB),
        Analise = parcial(Escolha, LB, Incs)
    ).

analisar_obs([], F, F, Acc, Acc).
analisar_obs([Ob|Obs], F0, F, Acc0, Acc) :-
    Ob = ob(Oi, T, D, R, Tps, Grau, _),
    professor_fixo(Tps, Fixo),
    (   Fixo \== none
    ->  Fixo = tp(_, _, _, NB, Gs),
        estado_grupos(Gs, 0, Uns, 0, CUns, true, Completo),
        F1 is F0 + CUns,
        (   Completo == true
        ->  Acc1 = Acc0
        ;   Rr is R - Uns,
            capacidade_restante(NB, Livre),
            folga_grupos(Gs, 0, Folga),
            (   Folga >= Rr, Livre >= Rr
            ->  true
            ;   contar(staggy_podas_escassez),
                fail
            ),
            posicoes_restantes(Gs, folga, 0, SPos),
            binomial(SPos, Rr, E),
            preencher_lb(Gs, Rr, folga, 0, LBo),
            Acc1 = [inc(E, Grau, Oi, T, D, Fixo, Rr, [cand(LBo, Fixo)], LBo)|Acc0]
        )
    ;   F1 = F0,
        candidatos(Tps, R, [], Cands0, 0, E, inf, LBo),
        (   E > 0
        ->  true
        ;   contar(staggy_podas_escassez),
            fail
        ),
        reverse(Cands0, Cands),
        Acc1 = [inc(E, Grau, Oi, T, D, none, R, Cands, LBo)|Acc0]
    ),
    analisar_obs(Obs, F1, F, Acc1, Acc).

professor_fixo([], none).
professor_fixo([Tp|Tps], Fixo) :-
    Tp = tp(_, Y, _, _, _),
    (   Y == 1
    ->  Fixo = Tp
    ;   professor_fixo(Tps, Fixo)
    ).

% Uns = Σ inf(N): blocos já comprometidos; CUns: seu custo; Completo se todos
% os N estão fixados.
estado_grupos([], U, U, C, C, Comp, Comp).
estado_grupos([g(_, Custo, N, _)|Gs], U0, U, C0, C, Comp0, Comp) :-
    (   integer(N)
    ->  U1 is U0 + N, C1 is C0 + N*Custo, Comp1 = Comp0
    ;   fd_inf(N, Inf), U1 is U0 + Inf, C1 is C0 + Inf*Custo, Comp1 = false
    ),
    estado_grupos(Gs, U1, U, C1, C, Comp1, Comp).

folga_grupos([], F, F).
folga_grupos([g(_, _, N, _)|Gs], F0, F) :-
    (   integer(N)
    ->  F1 = F0
    ;   fd_inf(N, I), fd_sup(N, S), F1 is F0 + S - I
    ),
    folga_grupos(Gs, F1, F).

% Menor custo para completar Rr blocos preenchendo primeiro os dias/turnos
% mais baratos (grupos já ordenados por custo) — relaxação da obrigação.
preencher_lb([], _, _, LB, LB).
preencher_lb([g(_, Custo, N, _)|Gs], Rr, Modo, LB0, LB) :-
    (   Rr =< 0
    ->  LB = LB0
    ;   capacidade_grupo(Modo, N, Cap),
        Toma is min(Cap, Rr),
        LB1 is LB0 + Toma*Custo,
        Rr1 is Rr - Toma,
        preencher_lb(Gs, Rr1, Modo, LB1, LB)
    ).

capacidade_grupo(folga, N, Cap) :-
    (   integer(N) -> Cap = 0 ; fd_inf(N, I), fd_sup(N, S), Cap is S - I ).
capacidade_grupo(total, N, Cap) :-
    (   integer(N) -> Cap = N ; fd_sup(N, Cap) ).

% |S(o,p)| (ET-04): posições ainda compatíveis — W indecididas nos dias/turnos
% em que a contagem ainda pode crescer (dias/turnos saturados pelas
% restrições de capacidade ficam de fora).
posicoes_restantes([], _, S, S).
posicoes_restantes([g(_, _, N, WVs)|Gs], Modo, S0, S) :-
    (   integer(N)
    ->  S1 = S0
    ;   fd_inf(N, I), fd_sup(N, Sup),
        (   ( Modo == folga -> Sup > I ; Sup > 0 )
        ->  include(var, WVs, Livres), length(Livres, L), S1 is S0 + L
        ;   S1 = S0
        )
    ),
    posicoes_restantes(Gs, Modo, S1, S).

% Candidato p ainda sem decisão: Y(o,p) pode valer 1, há ao menos R blocos
% possíveis nos dias/turnos e capacidade docente restante (ET-04 i–iv).
% E(o) = Σp C(|S(o,p)|, r(o)).
candidatos([], _, Cs, Cs, E, E, LB, LB).
candidatos([Tp|Tps], Rr, Cs0, Cs, E0, E, LB0, LB) :-
    Tp = tp(_, Y, _, NB, Gs),
    (   Y \== 0,
        capacidade_restante(NB, Livre),
        Livre >= Rr,
        soma_sup(Gs, 0, Sup),
        Sup >= Rr
    ->  posicoes_restantes(Gs, total, 0, S),
        binomial(S, Rr, B),
        E1 is E0 + B,
        preencher_lb(Gs, Rr, total, 0, Inc),
        LB1 is min(LB0, Inc),
        candidatos(Tps, Rr, [cand(Inc, Tp)|Cs0], Cs, E1, E, LB1, LB)
    ;   candidatos(Tps, Rr, Cs0, Cs, E0, E, LB0, LB)
    ).

soma_sup([], S, S).
soma_sup([g(_, _, N, _)|Gs], S0, S) :-
    (   integer(N) -> S1 is S0 + N ; fd_sup(N, Sup), S1 is S0 + Sup ),
    soma_sup(Gs, S1, S).

capacidade_restante(NB, Livre) :-
    i_cap(Cap),
    (   integer(NB) -> Min = NB ; fd_inf(NB, Min) ),
    Livre is Cap - Min.

somar_lb(inc(_, _, _, _, _, _, _, _, LBo), A0, A) :-
    A is A0 + LBo.

% Menor E(o) positivo; empate: maior grau de concorrência; depois ID canônico.
melhor_inc([I|Is], Melhor) :-
    foldl(melhor_de, Is, I, Melhor).

melhor_de(I, M0, M) :-
    I = inc(E1, G1, O1, _, _, _, _, _, _),
    M0 = inc(E2, G2, O2, _, _, _, _, _, _),
    (   E1 < E2 -> M = I
    ;   E1 > E2 -> M = M0
    ;   G1 > G2 -> M = I
    ;   G1 < G2 -> M = M0
    ;   O1 < O2 -> M = I
    ;   M = M0
    ).

% Limite inferior comprovado: custo já comprometido + para cada obrigação
% incompleta o menor custo de completá-la isoladamente (relaxação sem
% conflitos). Só poda quando supera o limite vigente de C (CA-45).
verificar_limite_inferior(C, LB) :-
    (   integer(C) -> Sup = C ; fd_sup(C, Sup) ),
    (   Sup == sup -> true
    ;   LB =< Sup -> true
    ;   contar(staggy_podas_limite),
        fail
    ).

% Reforço do limite inferior pelo mínimo docente: cada participante u ainda
% sem obrigação receberá uma obrigação o_u distinta, e o custo real é
% ≥ Σo min_p c(o,p) + Σu min_o [c(o,u) − min_p c(o,p)] (os o_u são
% distintos, logo cada mínimo é contado uma vez). Se u não tem opção, a
% verificação de cobertura falha em seguida.
extra_cobertura([], _, 0) :- !.
extra_cobertura(Us0, Incs, Extra) :-
    empty_assoc(A0),
    foldl(deltas_inc, Incs, A0, A),
    foldl(somar_delta(A), Us0, 0, Extra).

deltas_inc(inc(_, _, _, _, _, Fixo, _, Cands, LBo), A0, A) :-
    (   Fixo == none
    ->  foldl(delta_cand(LBo), Cands, A0, A)
    ;   A = A0
    ).

delta_cand(LBo, cand(Inc, tp(P, _, _, _, _)), A0, A) :-
    Delta is Inc - LBo,
    (   get_assoc(P, A0, D0), D0 =< Delta
    ->  A = A0
    ;   put_assoc(P, A0, Delta, A)
    ).

somar_delta(A, pr(P, _, _, _, _), S0, S) :-
    (   get_assoc(P, A, D) -> S is S0 + D ; S = S0 ).

% Cobertura mínima docente (ET-15, CA-171): participantes ainda sem obrigação
% precisam de obrigações distintas ainda sem responsável.
verificar_cobertura(Us0, Incs) :-
    (   Us0 == []
    ->  true
    ;   findall(P-Oi,
                ( member(inc(_, _, Oi, _, _, none, _, Cands, _), Incs),
                  member(cand(_, tp(P, _, _, _, _)), Cands) ),
                Arestas),
        adjacencia(Arestas, Adj),
        maplist(pr_id, Us0, Us),
        emparelhar(Us, Adj, NaoCobertos),
        (   NaoCobertos == []
        ->  true
        ;   contar(staggy_podas_cobertura),
            fail
        )
    ).

sem_atribuicao(pr(_, _, _, Ys, _)) :-
    \+ ( member(Y, Ys), Y == 1 ).

pr_id(pr(P, _, _, _, _), P).

% Ramificação: responsável de menor custo incremental primeiro (Y=1 | Y=0);
% depois as contagens do dia/turno mais barato, do maior valor ao menor.
ramificar(inc(_, _, _, _, _, Fixo, _, Cands, _), WsPorDT) :-
    (   Fixo == none
    ->  menor_cand(Cands, tp(_, Y, _, _, _)),
        (   Y = 1
        ;   contar(staggy_retrocessos),
            Y = 0
        )
    ;   Fixo = tp(_, _, _, _, Gs),
        primeiro_grupo_livre(Gs, g(DT, _, N, _)),
        fd_inf(N, Inf),
        fd_sup(N, Sup),
        numlist(Inf, Sup, Vs0),
        reverse(Vs0, Vs),
        Vs = [V1|Resto],
        (   N = V1
        ;   member(V, Resto),
            contar(staggy_retrocessos),
            N = V
        ),
        checar_dt(WsPorDT, DT)
    ).

menor_cand([cand(I, Tp)|Cs], Melhor) :-
    menor_cand_(Cs, I, Tp, Melhor).

menor_cand_([], _, Tp, Tp).
menor_cand_([cand(I, Tp)|Cs], I0, Tp0, M) :-
    (   I < I0
    ->  menor_cand_(Cs, I, Tp, M)
    ;   menor_cand_(Cs, I0, Tp0, M)
    ).

primeiro_grupo_livre([G|Gs], Livre) :-
    G = g(_, _, N, _),
    (   var(N)
    ->  Livre = G
    ;   primeiro_grupo_livre(Gs, Livre)
    ).

% Registro das decisões (CA-37, CA-116): só com a opção rastreio(N).
rastrear(inc(E, G, _, T, D, Fixo, Rr, Cands, _)) :-
    nb_getval(staggy_rastreio, Max),
    (   Max > 0,
        flag(staggy_decisoes, N, N+1),
        N < Max
    ->  length(Cands, NC),
        (   Fixo == none
        ->  menor_cand(Cands, tp(P, _, _, _, _)), Acao = escolher_professor
        ;   Fixo = tp(P, _, _, _, _), Acao = distribuir_blocos
        ),
        decorrido_ms(Ms),
        emitir(_{tipo:decisao, ordem:N, turma_id:T, disciplina_id:D, escassez:E, grau:G,
                 r_restante:Rr, candidatos:NC, acao:Acao, professor_id:P, tempo_ms:Ms})
    ;   true
    ).

% ---------------------------------------------------------------------------
% Otimização hierárquica com prazo único (RN-48, RN-51, CA-136)
% ---------------------------------------------------------------------------

resolver_instancia :-
    construir_modelo(M),
    prechecar(M, Inviab),
    (   Inviab \== []
    ->  finalizar_sem_grade('INVIAVEL_COMPROVADA', 'INVIABILIDADE_COMPROVADA', provas_inviavel(prechecagem), Inviab)
    ;   (   postar_restricoes(M)
        ->  otimizar(M)
        ;   diag_inviavel('INVIAVEL_POR_PROPAGACAO',
                          'A propagação das restrições obrigatórias demonstrou que não existe grade completa; a combinação causadora não foi isolada',
                          _{}, D),
            finalizar_sem_grade('INVIAVEL_COMPROVADA', 'INVIABILIDADE_COMPROVADA', provas_inviavel(propagacao), [D])
        )
    ).

otimizar(M) :-
    nivel_custo(M, R1),
    nb_getval(staggy_inc, Inc),
    (   Inc == none
    ->  (   R1 == completo
        ->  diag_inviavel('BUSCA_ESGOTADA',
                          'A busca completa esgotou todas as alternativas legais sem encontrar grade que cumpra as obrigações (CA-54)',
                          _{}, D),
            finalizar_sem_grade('INVIAVEL_COMPROVADA', 'INVIABILIDADE_COMPROVADA', provas_inviavel(busca), [D])
        ;   D = _{categoria:resultado, codigo:'SEM_GRADE_NO_PRAZO', severidade:aviso, etapa:busca,
                  mensagem:'O prazo terminou sem grade completa e sem prova de inviabilidade; não se afirma impossibilidade (CA-53, CA-123)',
                  entidades:_{}, natureza_evidencia:comprovada},
            nb_setval(staggy_limites, ['TEMPO']),
            finalizar_sem_grade('INCONCLUSIVA', 'LIMITE_TEMPO', provas_inconclusivas, [D])
        )
    ;   cadeia_niveis(M, R1, Provas),
        finalizar_com_grade(Provas)
    ).

cadeia_niveis(M, R1, [1-R1, 2-R2, 3-R3, 4-R4]) :-
    (   R1 == completo
    ->  fixar_custo(M),
        nivel_iterativo(M, 2, R2),
        (   R2 == completo
        ->  fixar_max(M),
            nivel_iterativo(M, 3, R3),
            (   R3 == completo
            ->  fixar_min(M),
                nivel_canonico(M, R4)
            ;   R4 = nao_executado
            )
        ;   R3 = nao_executado, R4 = nao_executado
        )
    ;   R2 = nao_executado, R3 = nao_executado, R4 = nao_executado
    ).

registrar_tempo_nivel(Nivel, T0) :-
    get_time(T1),
    Ms is round((T1 - T0) * 1000),
    nb_getval(staggy_tempos, L),
    nb_setval(staggy_tempos, [Nivel-Ms|L]).

% Nível 1: branch-and-bound em profundidade; cada grade nova reduz o limite
% superior de C e a busca prossegue na mesma árvore. Esgotada a árvore, o
% incumbente é o mínimo comprovado (ou a instância é inviável).
nivel_custo(M, R) :-
    get_time(T0),
    restante(Seg),
    (   Seg =< 0
    ->  R = tempo
    ;   catch(call_with_time_limit(Seg, ( busca_bnb(M) ; true )), time_limit_exceeded, Tempo = sim),
        (   Tempo == sim -> R = tempo ; R = completo )
    ),
    registrar_tempo_nivel(1, T0).

busca_bnb(M) :-
    buscar(M, custo),
    extrair_solucao(M, Sol),
    registrar_incumbente(Sol, 1),
    Sol = sol(_, C, _, _, _, _, _, _, _),
    UB is C - 1,
    nb_setval(staggy_ub, UB),
    fail.

fixar_custo(modelo(_, _, C, _, _, _)) :-
    nb_getval(staggy_inc, sol(_, Cstar, _, _, _, _, _, _, _)),
    C #= Cstar,
    emitir_prova(1).

% Níveis 2 e 3: reinícios com exigência de melhoria estrita sobre o
% incumbente, até a busca completa falhar (mínimo comprovado).
nivel_iterativo(M, Nivel, R) :-
    get_time(T0),
    nivel_iterativo_(M, Nivel, R),
    registrar_tempo_nivel(Nivel, T0).

nivel_iterativo_(M, Nivel, R) :-
    restante(Seg),
    (   Seg =< 0
    ->  R = tempo
    ;   nb_getval(staggy_inc, Inc),
        catch(call_with_time_limit(Seg,
                  findall(Sol,
                          once(( exigir_melhoria(Nivel, M, Inc),
                                 buscar(M, equidade),
                                 extrair_solucao(M, Sol) )),
                          Sols)),
              time_limit_exceeded, Sols = tempo),
        (   Sols == tempo
        ->  R = tempo
        ;   Sols = [Sol]
        ->  registrar_incumbente(Sol, Nivel),
            nivel_iterativo_(M, Nivel, R)
        ;   R = completo
        )
    ).

% M_p = C_p / (K·NB_p), com A_p = K·NB_p > 0 para todo participante.
% Melhoria estrita do nível 2: todo M_p < max atual (max diminui).
exigir_melhoria(2, modelo(_, Profs, _, _, _, _), sol(_, _, _, _, _, Max, _, _, _)) :-
    Max \== none,
    Max = N/D,
    maplist(media_relacao(#<, N, D), Profs).
% Nível 3: com max fixado no ótimo, amplitude menor ⇔ min M_p maior.
exigir_melhoria(3, modelo(_, Profs, _, _, _, _), sol(_, _, _, _, _, _, Min, _, _)) :-
    Min \== none,
    Min = N/D,
    maplist(media_relacao(#>, N, D), Profs).

% D·C_p  Rel  N·K·NB_p   ⇔   M_p Rel N/D   (aritmética inteira exata, CA-70)
media_relacao(Rel, N, D, pr(_, NB, Cp, _, _)) :-
    i_k(K),
    Esq = D*Cp,
    Dir = N*K*NB,
    call(Rel, Esq, Dir).

fixar_max(modelo(_, Profs, _, _, _, _)) :-
    nb_getval(staggy_inc, sol(_, _, _, _, _, Max, _, _, _)),
    (   Max = N/D
    ->  maplist(media_relacao(#=<, N, D), Profs)
    ;   true
    ),
    emitir_prova(2).

fixar_min(modelo(_, Profs, _, _, _, _)) :-
    nb_getval(staggy_inc, sol(_, _, _, _, _, _, Min, _, _)),
    (   Min = N/D
    ->  maplist(media_relacao(#>=, N, D), Profs)
    ;   true
    ),
    emitir_prova(3).

% Nível 4 (ET-05, ET-13): menor chave canônica entre as grades que mantêm os
% níveis 1–3. Percorre as posições na ordem canônica com uma grade
% testemunha (o incumbente, que satisfaz todas as fixações): onde a
% testemunha tem vaga, V=0 já é o mínimo; onde tem aula de posto w, a busca
% completa decide se existe grade com V < w — se existe, vira a nova
% testemunha (e incumbente); se não, a falha comprova o mínimo e V é fixado.
nivel_canonico(M, R) :-
    get_time(T0),
    M = modelo(_, _, _, Posicoes, _, _),
    nb_getval(staggy_inc, Sol0),
    restante(Seg),
    (   Seg =< 0
    ->  R = tempo
    ;   catch(call_with_time_limit(Seg, lex_minimo(M, Posicoes, Sol0, SolF)),
              time_limit_exceeded, SolF = tempo),
        (   SolF == tempo
        ->  R = tempo
        ;   registrar_incumbente(SolF, 4),
            emitir_prova(4),
            R = completo
        )
    ),
    registrar_tempo_nivel(4, T0).

lex_minimo(M, Posicoes, Sol0, SolF) :-
    valores_posicoes(Sol0, Posicoes, W0),
    lex_(Posicoes, W0, M, Sol0, SolF).

lex_([], [], _, Sol, Sol).
lex_([pos(T, Ci, V, _)|Ps], [W|_], M, Sol0, SolF) :-
    (   W =:= 0
    ->  Sol1 = Sol0,
        WF = 0
    ;   melhorar_posicao(V, W, T, Ci, M, Sol0, Sol1, WF)
    ),
    V #= WF,
    valores_posicoes(Sol1, Ps, Ws1),
    lex_(Ps, Ws1, M, Sol1, SolF).

melhorar_posicao(V, W, T, Ci, M, Sol0, SolF, WF) :-
    findall(S, once(( V #< W, buscar(M, equidade), extrair_solucao(M, S) )), Ss),
    (   Ss = [S]
    ->  registrar_incumbente(S, 4),
        valor_posicao(S, T, Ci, W1),
        melhorar_posicao(V, W1, T, Ci, M, S, SolF, WF)
    ;   SolF = Sol0,
        WF = W
    ).

valores_posicoes(Sol, Posicoes, Ws) :-
    maplist(valor_posicao_pos(Sol), Posicoes, Ws).

valor_posicao_pos(Sol, pos(T, Ci, _, _), W) :-
    valor_posicao(Sol, T, Ci, W).

valor_posicao(sol(Oc, _, _, _, _, _, _, _, _), T, Ci, W) :-
    (   memberchk(oc(Ci, T, D, P, _, _, _), Oc)
    ->  nb_getval(staggy_postos, Postos),
        get_assoc(D-P, Postos, W)
    ;   W = 0
    ).

% ---------------------------------------------------------------------------
% Solução, métricas e chave canônica (CP-08, ET-05, ET-13)
%   sol(Ocupacoes, C, ParcelaDiaTurno, ParcelaDisciplina, PorProfessor,
%       MaxM, MinM, Amplitude, Chave)
% ---------------------------------------------------------------------------

extrair_solucao(modelo(Obs, _, _, _, _, _), Sol) :-
    foldl(ocupacoes_ob, Obs, [], Oc),
    metricas(Oc, Sol).

ocupacoes_ob(ob(_, T, D, _, Tps, _, _), Acc0, Acc) :-
    foldl(ocupacoes_tp(T, D), Tps, Acc0, Acc).

ocupacoes_tp(T, D, tp(P, Y, Ws, _, _), Acc0, Acc) :-
    (   Y == 1
    ->  foldl(ocupacao_w(T, D, P), Ws, Acc0, Acc)
    ;   Acc = Acc0
    ).

ocupacao_w(T, D, P, w(Ci, W, Custo, CDT, CD), Acc0, Acc) :-
    (   W == 1
    ->  Acc = [oc(Ci, T, D, P, Custo, CDT, CD)|Acc0]
    ;   Acc = Acc0
    ).

metricas(Oc0, sol(Oc, C, PDT, PD, PorProf, Max, Min, Amp, Chave)) :-
    ordenar_ocupacoes(Oc0, Oc),
    foldl(somar_ocupacao, Oc, 0-0-0, C-PDT-PD),
    professores_canonicos(PIds),
    i_k(K),
    maplist(estat_prof(Oc, K), PIds, PorProf),
    medias(PorProf, Max, Min, Amp),
    chave_canonica(Oc, Chave).

ordenar_ocupacoes(Oc0, Oc) :-
    findall(k(Ci, TB)-oc(Ci, T, D, P, Cu, CDT, CD),
            ( member(oc(Ci, T, D, P, Cu, CDT, CD), Oc0), i_turma(T, _, _, TB) ),
            Pares),
    keysort(Pares, Ord),
    pairs_values(Ord, Oc).

somar_ocupacao(oc(_, _, _, _, Cu, CDT, CD), C0-A0-B0, C-A-B) :-
    C is C0 + Cu, A is A0 + CDT, B is B0 + CD.

estat_prof(Oc, K, P, ps(P, Aulas, Cp)) :-
    aggregate_all(count, member(oc(_, _, _, P, _, _, _), Oc), N),
    aggregate_all(sum(Cu), member(oc(_, _, _, P, Cu, _, _), Oc), Cp),
    Aulas is N * K.

medias(PorProf, Max, Min, Amp) :-
    findall(R, ( member(ps(_, A, Cp), PorProf), A > 0, racional(Cp, A, R) ), Rs),
    (   Rs == []
    ->  Max = none, Min = none, Amp = none
    ;   Rs = [R0|_],
        foldl(max_racional, Rs, R0, Max),
        foldl(min_racional, Rs, R0, Min),
        Max = N1/D1, Min = N2/D2,
        Na is N1*D2 - N2*D1, Da is D1*D2,
        racional(Na, Da, Amp)
    ).

max_racional(R, M0, M) :-
    comparar_racionais(O, R, M0),
    ( O == (>) -> M = R ; M = M0 ).

min_racional(R, M0, M) :-
    comparar_racionais(O, R, M0),
    ( O == (<) -> M = R ; M = M0 ).

% Chave canônica: uma entrada por posição de cada turma (inclusive vagas),
% campos (dia ISO, turno, índice, curso, período, turma, disciplina,
% professor, ocupado) comparados numericamente / por bytes UTF-8.
% Serialização: "staggy.chave.v1|" + entradas "d.t.i.hexC.hexP.hexT.hexD.hexPr.o"
% unidas por ";", com IDs em hexadecimal minúsculo dos bytes UTF-8.
chave_canonica(Oc, Chave) :-
    i_meta(curso_id, Curso), id_bytes(Curso, CB),
    i_meta(periodo_letivo_id, Per), id_bytes(Per, PB),
    findall(e(DI, TC, Idx, CB, PB, TB, DB, PrB, O),
            ( i_turma(T, _, Turno, TB),
              i_coord(Ci, Dia, Turno, Idx),
              dia_iso(Dia, DI), turno_cod(Turno, TC),
              (   memberchk(oc(Ci, T, D, P, _, _, _), Oc)
              ->  id_bytes(D, DB), id_bytes(P, PrB), O = 1
              ;   DB = [], PrB = [], O = 0
              ) ),
            Es0),
    msort(Es0, Es),
    maplist(serializar_entrada, Es, Partes),
    atomic_list_concat(Partes, ';', Corpo),
    versao_chave(V),
    atomic_list_concat([V, '|', Corpo], Chave).

serializar_entrada(e(DI, TC, Idx, CB, PB, TB, DB, PrB, O), S) :-
    maplist(bytes_hex, [CB, PB, TB, DB, PrB], [HC, HP, HT, HD, HPr]),
    format(atom(S), '~w.~w.~w.~w.~w.~w.~w.~w.~w', [DI, TC, Idx, HC, HP, HT, HD, HPr, O]).

% ---------------------------------------------------------------------------
% Eventos e resultado (contrato staggy.resultado.v1, ET-06, CA-62, CA-73)
% ---------------------------------------------------------------------------

registrar_incumbente(Sol, Nivel) :-
    nb_setval(staggy_inc, Sol),
    contar(staggy_solucoes),
    decorrido_ms(Ms),
    (   nb_getval(staggy_t_primeira, none)
    ->  nb_setval(staggy_t_primeira, Ms)
    ;   true
    ),
    nb_getval(staggy_ids, RunId-Hash),
    sol_campos(Sol, Campos),
    put_dict(_{tipo:incumbente, run_id:RunId, snapshot_hash:Hash, nivel:Nivel, tempo_ms:Ms}, Campos, Evento),
    emitir(Evento).

emitir_prova(Nivel) :-
    nb_getval(staggy_ids, RunId-Hash),
    nb_getval(staggy_inc, Sol),
    valor_nivel(Nivel, Sol, Valor),
    decorrido_ms(Ms),
    objetivo(Nivel, Obj),
    emitir(_{tipo:prova, run_id:RunId, snapshot_hash:Hash, nivel:Nivel, objetivo:Obj,
             valor:Valor, tempo_ms:Ms}).

objetivo(1, custo_primario).
objetivo(2, max_media_docente).
objetivo(3, amplitude_medias).
objetivo(4, chave_canonica).

metodo(1, branch_and_bound_profundidade_completo).
metodo(2, reinicios_com_melhoria_estrita_busca_completa).
metodo(3, reinicios_com_melhoria_estrita_busca_completa).
metodo(4, rotulacao_lexicografica_canonica_completa).

valor_nivel(1, sol(_, C, _, _, _, _, _, _, _), C).
valor_nivel(2, sol(_, _, _, _, _, Max, _, _, _), V) :- racional_json(Max, V).
valor_nivel(3, sol(_, _, _, _, _, _, _, Amp, _), V) :- racional_json(Amp, V).
valor_nivel(4, sol(_, _, _, _, _, _, _, _, Ch), Ch).

racional_json(none, null) :- !.
racional_json(N/D, _{num:N, den:D}).

sol_campos(sol(Oc, C, PDT, PD, PorProf, Max, Min, Amp, Chave), Campos) :-
    maplist(ocupacao_json, Oc, OcJ),
    maplist(prof_json, PorProf, ProfJ),
    totais_turma_disciplina(Oc, Totais),
    racional_json(Max, MaxJ),
    racional_json(Min, MinJ),
    racional_json(Amp, AmpJ),
    Campos = _{ocupacoes:OcJ, 'C':C, parcelas:_{dia_turno:PDT, disciplina:PD},
               aulas_por_professor:ProfJ, total_aulas_por_turma_disciplina:Totais,
               max_M_p:MaxJ, min_M_p:MinJ, amplitude_M:AmpJ, chave_canonica:Chave}.

ocupacao_json(oc(Ci, T, D, P, _, _, _),
              _{turma_id:T, dia:Dia, turno:Turno, indice:Idx, disciplina_id:D, professor_id:P}) :-
    i_coord(Ci, Dia, Turno, Idx).

prof_json(ps(P, A, Cp), _{professor_id:P, aulas:A, custo:Cp}).

totais_turma_disciplina(Oc, Totais) :-
    i_k(K),
    turmas_canonicas(Ts),
    findall(_{turma_id:T, disciplina_id:D, aulas:A},
            ( member(t(T, S, _), Ts),
              disciplinas_do_semestre(S, Ds),
              member(d(D, _), Ds),
              aggregate_all(count, member(oc(_, T, D, _, _, _, _), Oc), N),
              A is N * K ),
            Totais).

estatisticas(_{nos:N, retrocessos:R, podas_limite_inferior:PL, podas_cobertura:PC,
               podas_escassez:PE, podas_colocacao:PCo, solucoes:S, tempo_por_nivel_ms:Tempos}) :-
    flag(staggy_nos, N, N),
    flag(staggy_retrocessos, R, R),
    flag(staggy_podas_limite, PL, PL),
    flag(staggy_podas_cobertura, PC, PC),
    flag(staggy_podas_escassez, PE, PE),
    flag(staggy_podas_colocacao, PCo, PCo),
    flag(staggy_solucoes, S, S),
    nb_getval(staggy_tempos, L),
    findall(_{nivel:Nv, ms:Ms}, member(Nv-Ms, L), Tempos0),
    reverse(Tempos0, Tempos).

provas_json(provas_nao_executadas, Ps) :- !,
    findall(P, ( between(1, 4, N), prova_json(N, nao_executado, none, P) ), Ps).
provas_json(provas_inviavel(_), Ps) :- !,
    provas_json(provas_nao_executadas, Ps).
provas_json(provas_inconclusivas, Ps) :- !,
    findall(P, ( between(1, 4, N),
                 ( N =:= 1 -> R = tempo ; R = nao_executado ),
                 prova_json(N, R, none, P) ), Ps).
provas_json(Lista, Ps) :-
    nb_getval(staggy_inc, Sol),
    findall(P, ( member(N-R, Lista), prova_json(N, R, Sol, P) ), Ps).

prova_json(N, R, Sol, _{nivel:N, objetivo:Obj, metodo:Met, estado:Estado, comprovado:Comp, valor:Valor}) :-
    objetivo(N, Obj),
    metodo(N, Met),
    (   R == completo -> Estado = 'COMPROVADO', Comp = true
    ;   R == tempo -> Estado = 'NAO_COMPROVADO_LIMITE_TEMPO', Comp = false
    ;   R == falha_interna -> Estado = 'NAO_COMPROVADO_FALHA_INTERNA', Comp = false
    ;   Estado = 'NAO_EXECUTADO', Comp = false
    ),
    (   Sol == none -> Valor = null ; valor_nivel(N, Sol, Valor) ).

resultado_base(Status, Motivo, Diags, Base) :-
    nb_getval(staggy_ids, RunId-Hash),
    schema_resultado(SR),
    versao_motor(VM),
    policy_version(PV),
    decorrido_ms(Ms),
    nb_getval(staggy_t_primeira, TP0),
    ( TP0 == none -> TP = null ; TP = TP0 ),
    nb_getval(staggy_limites, Lim),
    estatisticas(Est),
    heuristica(H),
    findall(Id, i_trava(Id), Travas),
    Base = _{tipo:resultado, schema_version:SR, run_id:RunId, snapshot_hash:Hash,
             versao_motor:VM, policy_version:PV, status:Status, motivo_termino:Motivo,
             duracao_execucao_ms:Ms, tempo_primeira_grade_ms:TP, limites_atingidos:Lim,
             travas_aplicadas:Travas, diagnosticos:Diags, estatisticas:Est, heuristica:H}.

campos_sem_grade(_{ocupacoes:[], 'C':null, parcelas:null, aulas_por_professor:[],
                   total_aulas_por_turma_disciplina:[], max_M_p:null, min_M_p:null,
                   amplitude_M:null, chave_canonica:null}).

finalizar_sem_grade(Status, Motivo, ProvasTermo, Diags) :-
    resultado_base(Status, Motivo, Diags, Base),
    provas_json(ProvasTermo, Provas),
    campos_sem_grade(Vazio),
    put_dict(Vazio, Base, B1),
    put_dict(_{prova_por_nivel:Provas, candidato_recuperavel:null}, B1, R),
    emitir(R).

finalizar_erro(Motivo, Diags) :-
    resultado_base('ERRO_EXECUCAO', Motivo, Diags, Base),
    provas_json(provas_nao_executadas, Provas),
    campos_sem_grade(Vazio),
    nb_getval(staggy_inc, Inc),
    (   Inc == none
    ->  Cand = null
    ;   sol_campos(Inc, Cand)
    ),
    put_dict(Vazio, Base, B1),
    put_dict(_{prova_por_nivel:Provas, candidato_recuperavel:Cand}, B1, R),
    emitir(R).

finalizar_com_grade(Lista) :-
    (   forall(member(_-R, Lista), R == completo)
    ->  Status = 'OTIMA_COMPROVADA', Motivo = 'BUSCA_CONCLUIDA', Diags = []
    ;   Status = 'VALIDA_NAO_OTIMA',
        (   member(_-tempo, Lista)
        ->  Motivo = 'LIMITE_TEMPO', nb_setval(staggy_limites, ['TEMPO'])
        ;   Motivo = 'BUSCA_CONCLUIDA'
        ),
        findall(N, ( member(N-R, Lista), R \== completo ), Pendentes),
        findall(N, ( member(N-R, Lista), R == completo ), Comprovados),
        Diags = [_{categoria:resultado, codigo:'NIVEIS_NAO_COMPROVADOS', severidade:aviso, etapa:otimizacao,
                   mensagem:'Grade completa e válida, mas sem prova de todos os níveis da hierarquia (CA-52, CA-74)',
                   entidades:_{niveis_comprovados:Comprovados, niveis_nao_comprovados:Pendentes},
                   natureza_evidencia:comprovada}]
    ),
    resultado_base(Status, Motivo, Diags, Base),
    provas_json(Lista, Provas),
    nb_getval(staggy_inc, Sol),
    sol_campos(Sol, Campos),
    put_dict(Campos, Base, B1),
    put_dict(_{prova_por_nivel:Provas, candidato_recuperavel:null}, B1, R),
    emitir(R).
