import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { PatientRecord, SessionRecord } from "../api/types";
import { PatientRegisterPage } from "./PatientRegisterPage";

const ann: PatientRecord = { id: "p1", name: "Ann Lee", dateOfBirth: "1980-02-03", contact: "ann@example.org" };
const bo: PatientRecord = { id: "p2", name: "Bo Park", dateOfBirth: "1975-07-21", contact: null };

const linkedSession: SessionRecord = {
  id: "sess-1",
  subjectPseudoId: "subj-9",
  protocolId: "static-battery",
  protocolVersion: "v0-draft",
  deploymentContext: "clinic_supervised",
  consentRecordId: "c1",
  calibrationRef: null,
  subjectHeightMeters: null,
  state: "Observing",
  createdAt: "2026-10-23T09:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <PatientRegisterPage />
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PatientRegisterPage", () => {
  it("lists the register on load and searches by the typed text", async () => {
    const search = vi.spyOn(client, "searchPatients").mockResolvedValueOnce([ann, bo]).mockResolvedValueOnce([bo]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Ann Lee" })).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith("");

    await userEvent.type(screen.getByLabelText("Search patients"), "bo");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(search).toHaveBeenLastCalledWith("bo"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Ann Lee" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Bo Park" })).toBeInTheDocument();
  });

  it("says when no patient matches", async () => {
    vi.spyOn(client, "searchPatients").mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No patients match this search.")).toBeInTheDocument();
  });

  it("shows a search error instead of an empty register", async () => {
    vi.spyOn(client, "searchPatients").mockRejectedValue(new Error("GET /patients failed: 503"));
    renderPage();
    expect(await screen.findByText(/Could not load patients: .*503/)).toBeInTheDocument();
  });

  it("creates a patient with name and date of birth, contact optional", async () => {
    vi.spyOn(client, "searchPatients").mockResolvedValue([]);
    const create = vi.spyOn(client, "createPatient").mockResolvedValue(bo);
    vi.spyOn(client, "listPatientSessions").mockResolvedValue([]);
    renderPage();
    await screen.findByText("No patients match this search.");

    const form = screen.getByRole("form", { name: "Add a patient" });
    const submit = within(form).getByRole("button", { name: "Add patient" });
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText("Name"), "Bo Park");
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText("Date of birth"), "1975-07-21");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({ name: "Bo Park", dateOfBirth: "1975-07-21" });
    expect(await screen.findByRole("heading", { name: "Bo Park" })).toBeInTheDocument();
  });

  it("sends the contact when given and shows a create error", async () => {
    vi.spyOn(client, "searchPatients").mockResolvedValue([]);
    const create = vi.spyOn(client, "createPatient").mockRejectedValue(new Error("POST /patients failed: 400"));
    renderPage();
    await screen.findByText("No patients match this search.");

    const form = screen.getByRole("form", { name: "Add a patient" });
    await userEvent.type(within(form).getByLabelText("Name"), "Ann Lee");
    await userEvent.type(within(form).getByLabelText("Date of birth"), "1980-02-03");
    await userEvent.type(within(form).getByLabelText("Contact (optional)"), "ann@example.org");
    await userEvent.click(within(form).getByRole("button", { name: "Add patient" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: "Ann Lee", dateOfBirth: "1980-02-03", contact: "ann@example.org" })
    );
    expect(await screen.findByText(/Could not add the patient: .*400/)).toBeInTheDocument();
  });

  it("shows the selected patient's linked sessions with links to each session", async () => {
    vi.spyOn(client, "searchPatients").mockResolvedValue([ann]);
    const sessions = vi.spyOn(client, "listPatientSessions").mockResolvedValue([linkedSession]);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Ann Lee" }));

    expect(sessions).toHaveBeenCalledWith("p1");
    const link = await screen.findByRole("link", { name: "subj-9" });
    expect(link).toHaveAttribute("href", "/sessions/sess-1");
    const row = link.closest("tr") as HTMLElement;
    expect(within(row).getByText("Observing")).toBeInTheDocument();
    expect(screen.getByText("1980-02-03")).toBeInTheDocument();
    expect(screen.getByText("ann@example.org")).toBeInTheDocument();
  });

  it("says when a patient has no linked sessions yet", async () => {
    vi.spyOn(client, "searchPatients").mockResolvedValue([bo]);
    vi.spyOn(client, "listPatientSessions").mockResolvedValue([]);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Bo Park" }));
    expect(await screen.findByText("No sessions are linked to this patient yet.")).toBeInTheDocument();
  });
});

describe("PatientRegisterPage: erase", () => {
  async function openErase() {
    vi.spyOn(client, "searchPatients").mockResolvedValue([ann, bo]);
    vi.spyOn(client, "listPatientSessions").mockResolvedValue([linkedSession]);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Ann Lee" }));
    await userEvent.click(await screen.findByRole("button", { name: /Erase patient/ }));
    return screen.getByRole("dialog");
  }

  it("keeps the erase button disabled until the exact name is typed", async () => {
    const erase = vi.spyOn(client, "erasePatient").mockResolvedValue({ patientId: "p1", sessions: 1, clips: 1, reports: 0, events: 0, filesRemoved: 0 });
    const dialog = await openErase();
    const confirm = within(dialog).getByRole("button", { name: "Erase permanently" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox"), "Ann");
    expect(confirm).toBeDisabled();
    expect(erase).not.toHaveBeenCalled();
  });

  it("erases, then removes the patient from the list", async () => {
    const erase = vi.spyOn(client, "erasePatient").mockResolvedValue({ patientId: "p1", sessions: 1, clips: 1, reports: 0, events: 0, filesRemoved: 0 });
    const dialog = await openErase();
    await userEvent.type(within(dialog).getByRole("textbox"), "ann lee");
    await userEvent.click(within(dialog).getByRole("button", { name: "Erase permanently" }));
    await waitFor(() => expect(erase).toHaveBeenCalledWith("p1", "ann lee"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Ann Lee" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Bo Park" })).toBeInTheDocument();
  });

  it("shows the server's refusal and keeps the patient", async () => {
    vi.spyOn(client, "erasePatient").mockRejectedValue(new Error("This patient has adverse-event records, which are kept."));
    const dialog = await openErase();
    await userEvent.type(within(dialog).getByRole("textbox"), "Ann Lee");
    await userEvent.click(within(dialog).getByRole("button", { name: "Erase permanently" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("adverse-event records");
    expect(screen.getByRole("button", { name: "Ann Lee" })).toBeInTheDocument();
  });
});

