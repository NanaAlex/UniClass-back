:- encoding(utf8).
/*  Motor de teste: resolve normalmente, mas retém o evento "resultado" e
    fica parado — simula um motor que não encerra dentro do prazo, para o
    supervisor encerrá-lo (RN-48, RN-51, CA-120, CA-137).
*/
:- use_module('../../prolog/alocacao').
:- use_module(library(json)).
:- initialization(main, main).

main :-
    set_stream(user_input, encoding(utf8)),
    set_stream(user_output, encoding(utf8)),
    json_read_dict(user_input, S, []),
    resolver_snapshot(S, [], emitir_sem_resultado),
    sleep(120),
    halt(0).

emitir_sem_resultado(D) :-
    (   get_dict(tipo, D, resultado)
    ->  true
    ;   with_output_to(string(T), json_write_dict(current_output, D, [width(0)])),
        split_string(T, "\n", "", Partes),
        atomic_list_concat(Partes, ' ', Linha),
        writeln(Linha),
        flush_output
    ).
