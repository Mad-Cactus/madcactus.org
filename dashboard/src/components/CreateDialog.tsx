import { Show, createSignal, type JSX } from "solid-js";
import { toast } from "~/lib/toast";

/** Result contract for onSubmit: `error` keeps the dialog open and shows the
 *  message inline (inputs preserved); anything else is success. */
export type CreateResult = { error?: string; success?: string } & Record<string, unknown> | undefined;

/** The one creation pattern everywhere: trigger button → native <dialog>
 *  (ESC / ✕ / Cancel / backdrop close) → success toast + close, or
 *  renderSuccess(result) for one-time secrets that must be copied. */
export default function CreateDialog(props: {
	label: string;
	title: string;
	submitLabel?: string;
	/** extra classes for the trigger (default "btn btn-primary") */
	triggerClass?: string;
	/** overrides result.success in the toast (for redirect-only actions) */
	successMessage?: string;
	/** live submit-button text — e.g. a busy/progress accessor */
	submitText?: () => string;
	onSubmit: (fd: FormData, form: HTMLFormElement) => Promise<CreateResult>;
	renderSuccess?: (result: NonNullable<CreateResult>) => JSX.Element;
	children?: JSX.Element;
}) {
	let dialogRef!: HTMLDialogElement;
	const [error, setError] = createSignal("");
	// success payload once renderSuccess has taken over the body
	const [done, setDone] = createSignal<NonNullable<CreateResult> | null>(null);
	const [pending, setPending] = createSignal(false);

	function open() {
		setError("");
		setDone(null);
		dialogRef.showModal();
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const form = e.currentTarget as HTMLFormElement;
		if (pending()) return;
		setError("");
		setPending(true);
		let result: CreateResult;
		try {
			result = await props.onSubmit(new FormData(form), form);
		} catch (err) {
			setPending(false);
			setError(err instanceof Error ? err.message : "Something went wrong.");
			return;
		}
		setPending(false);
		if (result && result.error) {
			setError(result.error);
			return;
		}
		if (props.renderSuccess) {
			setDone(result ?? {});
			return;
		}
		toast(props.successMessage ?? result?.success ?? "Created.", "success");
		form.reset();
		dialogRef.close();
	}

	return (
		<>
			<button type="button" class={props.triggerClass ?? "btn btn-primary"} onClick={open}>
				{props.label}
			</button>
			<dialog
				class="modal"
				ref={dialogRef}
				// a click that hits the dialog element itself landed on the backdrop
				onClick={(e) => {
					if (e.target === dialogRef) dialogRef.close();
				}}
				onClose={() => {
					setDone(null);
					setError("");
				}}
			>
				<Show
					when={done() && props.renderSuccess ? props.renderSuccess : null}
					fallback={
						<form onSubmit={handleSubmit}>
							<h2 class="modal-title">{props.title}</h2>
							<div class="modal-body">
								{props.children}
								<Show when={error()}>
									<p class="login-error" style={{ margin: "12px 0 0" }}>{error()}</p>
								</Show>
							</div>
							<div class="modal-footer">
								<button type="button" class="btn" onClick={() => dialogRef.close()}>Cancel</button>
								<button type="submit" class="btn btn-primary" disabled={pending()}>
									{props.submitText ? props.submitText() : pending() ? "Saving…" : props.submitLabel ?? "Create"}
								</button>
							</div>
						</form>
					}
				>
					{(render) => (
						<>
							<div class="modal-body">{render()(done()!)}</div>
							<div class="modal-footer">
								<button type="button" class="btn btn-primary" onClick={() => dialogRef.close()}>Close</button>
							</div>
						</>
					)}
				</Show>
			</dialog>
		</>
	);
}
