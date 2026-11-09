:- encoding(utf8).
/*  Motor de teste: emite incumbentes e cai abruptamente (código 3) antes do
    resultado — simula queda do Prolog (RN-66, CA-175, AUD-006).
*/
:- use_module('../../prolog/alocacao').
:- use_module(library(json)).
:- initialization(main, main).

main :-
    set_stream(user_input, encoding(utf8)),
    set_stream(user_output, encoding(utf8)),
    json_read_dict(user_input, S, []),
    resolver_snapshot(S, [], emitir_e_cair),
    halt(0).

emitir_e_cair(D) :-
    get_dict(tipo, D, Tipo),
    (   Tipo == prova
    ->  halt(3)
    ;   Tipo == resultado
    ->  halt(3)
    ;   with_output_to(string(T), json_write_dict(current_output, D, [width(0)])),
        split_string(T, "\n", "", Partes),
        atomic_list_concat(Partes, ' ', Linha),
        writeln(Linha),
        flush_output
    ).
