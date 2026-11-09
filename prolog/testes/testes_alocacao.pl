:- encoding(utf8).
/*  Testes unitários do motor (plunit).

    swipl -g run_tests -t halt prolog/testes/testes_alocacao.pl
*/
:- use_module('../alocacao').
:- use_module(library(plunit)).

:- dynamic evento/1.

coletar(E) :-
    assertz(evento(E)).

% Os testes rodam no módulo da unidade; a limpeza precisa atingir user:evento/1
limpar :-
    retractall(evento(_)).

snapshot_minimo(_{schema_version:"staggy.snapshot.v1", run_id:"r1", curso_id:"ES", periodo_letivo_id:"2027/1",
                  form_version:"1", snapshot_hash:"h", 'K':2, turnos:["NOITE"], dias_letivos:["SEGUNDA"],
                  blocos_por_dia_turno:[_{dia:"SEGUNDA", turno:"NOITE", quantidade:2}],
                  turmas:[_{id:"T1", semestre_id:"S1", turno:"NOITE"}],
                  disciplinas:[_{id:"D1", semestre_id:"S1", carga_aulas:2}],
                  professores_participantes:[_{id:"P1", disciplinas_selecionadas_e_notas:[_{disciplina_id:"D1", nota:4}],
                                               blocos_selecionados:[_{dia:"SEGUNDA", turno:"NOITE", indice:2}],
                                               notas_dia_turno:[_{dia:"SEGUNDA", turno:"NOITE", nota:5}]}],
                  travas:[],
                  politica:_{policy_version:"staggy-preferencias-v2.7",
                             phi:[_{nota:5, penalidade:0}, _{nota:4, penalidade:1}, _{nota:3, penalidade:3},
                                  _{nota:2, penalidade:6}, _{nota:1, penalidade:10}],
                             peso_dia_turno:3, peso_disciplina:2, teto_aulas_professor:40,
                             minimo_disciplinas_professor:1},
                  limite_execucao_segundos:10}).

resultado(R) :-
    evento(R),
    get_dict(tipo, R, resultado), !.

:- begin_tests(politica).

test(phi_homologada) :-
    findall(P, ( member(N, [5, 4, 3, 2, 1]), phi(N, P) ), Ps),
    Ps == [0, 1, 3, 6, 10].

test(custo_ca42) :-
    custo_bloco(2, 2, 5, C),
    C =:= 36.

test(custo_multiplica_k) :-
    custo_bloco(3, 1, 1, C),
    C =:= 3 * (3*10 + 2*10).

:- end_tests(politica).

:- begin_tests(canonico).

test(ids_por_bytes_t1_t10_t2) :-
    comparar_ids(O1, 'T1', 'T10'), O1 == (<),
    comparar_ids(O2, 'T10', 'T2'), O2 == (<).

test(ids_utf8_sem_locale) :-
    comparar_ids(O, 'Á', 'B'),
    O == (>).

test(racionais_exatos) :-
    comparar_racionais(O, 10000000000000001/10000000000000000, 1/1),
    O == (>).

test(binomial) :-
    binomial(6, 2, B1), B1 =:= 15,
    binomial(4, 5, B2), B2 =:= 0,
    binomial(30, 3, B3), B3 =:= 4060.

:- end_tests(canonico).

:- begin_tests(resolucao).

test(grade_minima_otima) :-
    limpar,
    snapshot_minimo(S),
    resolver_snapshot(S, [], coletar),
    resultado(R),
    R.status == 'OTIMA_COMPROVADA',
    R.'C' =:= 2 * (3*0 + 2*1),
    R.ocupacoes = [O],
    O.indice =:= 2.

test(entrada_invalida_carga_nao_multipla) :-
    limpar,
    snapshot_minimo(S0),
    S = S0.put(disciplinas, [_{id:"D1", semestre_id:"S1", carga_aulas:3}]),
    resolver_snapshot(S, [], coletar),
    resultado(R),
    R.status == 'ENTRADA_INVALIDA',
    member(D, R.diagnosticos),
    D.codigo == 'CARGA_INCOMPATIVEL_COM_K', !.

test(inviavel_sem_docente) :-
    limpar,
    snapshot_minimo(S0),
    S = S0.put(disciplinas, [_{id:"D1", semestre_id:"S1", carga_aulas:2}, _{id:"D2", semestre_id:"S1", carga_aulas:2}]),
    resolver_snapshot(S, [], coletar),
    resultado(R),
    R.status == 'INVIAVEL_COMPROVADA'.

test(politica_divergente_rejeitada) :-
    limpar,
    snapshot_minimo(S0),
    P = S0.politica.put(peso_dia_turno, 4),
    S = S0.put(politica, P),
    resolver_snapshot(S, [], coletar),
    resultado(R),
    R.status == 'ENTRADA_INVALIDA'.

:- end_tests(resolucao).
