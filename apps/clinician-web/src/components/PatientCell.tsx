import type { SubjectNames } from "../api/client";

/** Patient name (or "Not linked") with the anonymous visit code underneath. */
export function PatientCell({ code, names }: { code: string; names: SubjectNames }) {
  const patient = names[code];
  return (
    <span className="patient-cell">
      <span className={patient ? "patient-cell__name" : "patient-cell__name patient-cell__name--none"}>
        {patient ? patient.name : "Not linked to a patient"}
      </span>
      <small className="patient-cell__code">{code}</small>
    </span>
  );
}
