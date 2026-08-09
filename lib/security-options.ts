export const SECURITY_FIELDS = [
  {
    question: "Qual é sua estação do ano preferida?",
    options: ["Primavera", "Verão", "Outono", "Inverno"],
  },
  {
    question: "Qual é seu animal preferido?",
    options: [
      "Cachorro",
      "Gato",
      "Cavalo",
      "Pássaro",
      "Coelho",
      "Peixe",
      "Leão",
      "Tigre",
      "Elefante",
      "Golfinho",
      "Tartaruga",
      "Macaco",
      "Urso",
      "Lobo",
    ],
  },
  {
    question: "Qual é sua cor preferida?",
    options: [
      "Azul",
      "Verde",
      "Vermelho",
      "Amarelo",
      "Laranja",
      "Roxo",
      "Rosa",
      "Preto",
      "Branco",
      "Cinza",
      "Marrom",
      "Bege",
    ],
  },
] as const;

export const SECURITY_QUESTIONS = SECURITY_FIELDS.map(
  (field) => field.question,
);

export function securityOptionsFor(question: string): readonly string[] {
  return (
    SECURITY_FIELDS.find((field) => field.question === question)?.options || []
  );
}

export function isAllowedSecurityAnswer(question: string, answer: string) {
  return securityOptionsFor(question).some(
    (option) =>
      option.toLocaleLowerCase("pt-BR") === answer.toLocaleLowerCase("pt-BR"),
  );
}
