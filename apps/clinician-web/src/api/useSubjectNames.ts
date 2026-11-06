import { useEffect, useState } from "react";
import { getSubjectNames, type SubjectNames } from "./client";

/**
 * Visit code -> patient name for clinician screens that list visits by their anonymous code.
 * Best effort: while loading, or if it fails, the map is empty and the screens show the code
 * and "Not linked", never a wrong name.
 */
export function useSubjectNames(): SubjectNames {
  const [names, setNames] = useState<SubjectNames>({});
  useEffect(() => {
    let cancelled = false;
    getSubjectNames()
      .then((result) => {
        if (!cancelled) setNames(result);
      })
      .catch(() => {
        // Names are a convenience; the visit code still identifies the session.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return names;
}
