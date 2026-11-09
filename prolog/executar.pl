:- encoding(utf8).
/*  Staggy — execução do motor pela linha de comando (usada pelo supervisor
    do backend, ET-09).

    swipl prolog/executar.pl [--entrada ARQUIVO] [--orcamento-ms N] [--rastreio N]

    Lê o snapshot JSON (do arquivo ou da entrada padrão) e escreve um evento
    JSON por linha na saída padrão, encerrando com o evento "resultado".
    Códigos de saída: 0 = resultado emitido; 2 = falha técnica fora do motor.
*/

:- use_module(alocacao).
:- use_module(library(option)).

% SWI-Prolog 10 moveu library(http/json) para library(json).
:- if(exists_source(library(json))).
:- use_module(library(json)).
:- else.
:- use_module(library(http/json)).
:- endif.

:- initialization(main, main).

main :-
    set_stream(user_input, encoding(utf8)),
    set_stream(user_output, encoding(utf8)),
    current_prolog_flag(argv, Argv),
    opcoes(Argv, Opcoes),
    (   ler_snapshot(Opcoes, Snap)
    ->  resolver_snapshot(Snap, Opcoes, emitir_linha)
    ;   json_malformado
    ),
    halt(0).

opcoes([], []).
opcoes(['--entrada', A|R], [entrada(A)|Os]) :- !,
    opcoes(R, Os).
opcoes(['--orcamento-ms', N|R], [orcamento_ms(V)|Os]) :- !,
    atom_number(N, V),
    opcoes(R, Os).
opcoes(['--rastreio', N|R], [rastreio(V)|Os]) :- !,
    atom_number(N, V),
    opcoes(R, Os).
opcoes([_|R], Os) :-
    opcoes(R, Os).

ler_snapshot(Opcoes, Snap) :-
    catch(( option(entrada(Arq), Opcoes)
          ->  setup_call_cleanup(open(Arq, read, In, [encoding(utf8)]),
                                 json_read_dict(In, Snap, []),
                                 close(In))
          ;   json_read_dict(user_input, Snap, [])
          ),
          _, fail).

emitir_linha(Dict) :-
    with_output_to(string(S), json_write_dict(current_output, Dict, [width(0)])),
    split_string(S, "\n", "", Partes),
    atomic_list_concat(Partes, ' ', Linha),
    write(user_output, Linha),
    nl(user_output),
    flush_output(user_output).

json_malformado :-
    emitir_linha(_{tipo:resultado, schema_version:'staggy.resultado.v1', run_id:null,
                   snapshot_hash:null, status:'ENTRADA_INVALIDA', motivo_termino:'ENTRADA_INVALIDA',
                   diagnosticos:[_{categoria:entrada_invalida, codigo:'JSON_MALFORMADO',
                                   severidade:erro, etapa:leitura,
                                   mensagem:'A entrada não é um JSON válido', entidades:_{},
                                   natureza_evidencia:comprovada}]}).
