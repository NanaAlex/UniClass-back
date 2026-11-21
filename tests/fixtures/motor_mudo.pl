:- encoding(utf8).
/*  Motor de teste: lê a entrada e não emite nada até ser encerrado pelo
    supervisor — prazo sem incumbente (CA-53, CA-138).
*/
:- initialization(main, main).

main :-
    read_string(user_input, _, _),
    sleep(120),
    halt(0).
