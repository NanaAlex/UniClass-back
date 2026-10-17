% Dados mocados para teste
professor(1, 'Maria Eduarda').
professor(2, 'Ana Julia').

materia(1, 'Geografia').
materia(2, 'Matematica').

turma(1, '1A').
turma(2, '2B').

%Materias que os profs podem lecionar
habilitados(1, 1).
habilitados(2, 2).

%Regra: Um professor pode assumir a turma que for habilitado na disciplina
pode_assumir(Professor, Turma, Materia) :-
    professor(Professor, _),
    turma(Turma, _),
    habilitados(Professor, Materia).