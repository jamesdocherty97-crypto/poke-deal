import type { Grade } from "../domain/types.js";

const DEFAULT_QUICK_GRADES: readonly Grade[] = ["RAW", "PSA_9", "PSA_10", "ACE_10"];

export function buildQuickGradeOptions(current: Grade): Grade[] {
  return [current, ...DEFAULT_QUICK_GRADES].filter(
    (grade, index, grades) => grades.indexOf(grade) === index,
  ).slice(0, 5);
}
