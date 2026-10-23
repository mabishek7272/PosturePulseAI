import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SignOffDialog } from "./SignOffDialog";

describe("SignOffDialog", () => {
  it("asks for the password and cannot be submitted empty", async () => {
    const onSubmit = vi.fn();
    render(<SignOffDialog onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: /Sign off/ })).toBeInTheDocument();
    const password = screen.getByLabelText("Your password");
    expect(password).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Sign off and release" })).toBeDisabled();
  });

  it("submits the password exactly once, even when submitted repeatedly", async () => {
    let resolve: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<SignOffDialog onSubmit={onSubmit} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Your password"), "correct horse");
    const button = screen.getByRole("button", { name: "Sign off and release" });
    const form = button.closest("form") as HTMLFormElement;
    // Two synchronous submits before React re-renders, then a click while pending.
    fireEvent.submit(form);
    fireEvent.submit(form);
    await userEvent.click(button);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("correct horse");
    await waitFor(() => expect(screen.getByRole("button", { name: /Signing off/ })).toBeDisabled());
    resolve();
  });

  it("shows the error, clears the password and allows another attempt after a rejection", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Sign-off not accepted: check your password and try again."))
      .mockResolvedValueOnce(undefined);
    render(<SignOffDialog onSubmit={onSubmit} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Your password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign off and release" }));
    await waitFor(() => expect(screen.getByText(/check your password/)).toBeInTheDocument());
    expect(screen.getByLabelText("Your password")).toHaveValue("");

    await userEvent.type(screen.getByLabelText("Your password"), "right");
    await userEvent.click(screen.getByRole("button", { name: "Sign off and release" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith("right");
  });

  it("cancels without submitting", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<SignOffDialog onSubmit={onSubmit} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
