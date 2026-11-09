// OC2 models questions as session forms (`FormInfo`). BloxMind's chat UI speaks
// OC1 `QuestionRequest`, so these helpers translate between the two shapes.
import type { QuestionRequest } from "./types";

/**
 * Fields the chat can answer. `external` fields need a browser round-trip and
 * are not answerable inline; hidden fields are not shown. Both the question and
 * answer mappers use this same filter so their indices stay aligned.
 */
export function answerableFormFields(form: unknown): Array<Record<string, unknown>> {
  const fields = Array.isArray((form as { fields?: unknown })?.fields)
    ? ((form as { fields: unknown[] }).fields as unknown[])
    : [];
  return fields.filter(
    (field): field is Record<string, unknown> =>
      !!field &&
      typeof field === "object" &&
      !(field as any).hidden &&
      (field as any).type !== "external",
  );
}

function formOptionLabel(option: any): string {
  if (typeof option?.label === "string" && option.label) return option.label;
  return String(option?.value ?? "");
}

export function translateOc2Form(form: any): QuestionRequest | null {
  if (!form?.id || !form?.sessionID) return null;
  const fields = answerableFormFields(form);
  const questions = fields.map((field: any) => {
    const options = Array.isArray(field.options)
      ? field.options.map((option: any) => ({
          label: formOptionLabel(option),
          ...(typeof option?.description === "string" && option.description
            ? { description: option.description }
            : {}),
        }))
      : field.type === "boolean"
        ? [{ label: "Yes" }, { label: "No" }]
        : [];
    return {
      header: String(field.title ?? field.key ?? "Input").slice(0, 30),
      question: String(field.description ?? field.title ?? field.key ?? ""),
      options,
      multiple: field.type === "multiselect",
      custom:
        typeof field.custom === "boolean"
          ? field.custom
          : field.type === "string" || field.type === "number" || field.type === "integer",
    };
  });
  if (!questions.length) return null;
  return { id: form.id, sessionID: form.sessionID, questions } as QuestionRequest;
}

/** Map OC1 `QuestionAnswer[]` (labels/raw text) back to an OC2 form answer object. */
export function buildOc2FormAnswer(
  form: any,
  answers: unknown,
): Record<string, string | number | boolean | string[]> {
  const fields = answerableFormFields(form);
  const list = Array.isArray(answers) ? answers : [];
  const answer: Record<string, string | number | boolean | string[]> = {};
  fields.forEach((field: any, index: number) => {
    const raw = list[index];
    const values = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) return;
    const optionValue = (value: string) => {
      const match = Array.isArray(field.options)
        ? field.options.find(
            (option: any) => formOptionLabel(option) === value || option?.value === value,
          )
        : undefined;
      return match?.value ?? value;
    };
    if (field.type === "multiselect") {
      answer[field.key] = values.map(optionValue).map(String);
    } else if (field.type === "boolean") {
      const value = values[0].toLowerCase();
      answer[field.key] = value === "yes" || value === "true" || value === "1";
    } else if (field.type === "number" || field.type === "integer") {
      const value = Number(values[0]);
      if (!Number.isNaN(value)) answer[field.key] = value;
    } else {
      answer[field.key] = optionValue(values[0]);
    }
  });
  return answer;
}
