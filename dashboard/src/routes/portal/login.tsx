import { Title } from "@solidjs/meta";
import { useAction } from "@solidjs/router";
import { Show, createSignal, onMount } from "solid-js";
import {
	clientLoginAction,
	setInvitePasswordAction,
} from "~/lib/client-queries";

export default function ClientLogin() {
	const login = useAction(clientLoginAction);
	const setPassword = useAction(setInvitePasswordAction);
	const [error, setError] = createSignal("");
	const [invite, setInvite] = createSignal<{
		accessToken?: string;
		tokenHash?: string;
	} | null>(null);
	const [linkExpired, setLinkExpired] = createSignal(false);

	// Invite emails land on /portal/login#access_token=…&type=invite — the
	// implicit-flow token only exists in the fragment, so the server never sees
	// it. Capture it here, then strip the URL so a refresh returns to the plain
	// sign-in form (re-click the email link to re-enter setup).
	onMount(() => {
		const hash = new URLSearchParams(window.location.hash.slice(1));
		const query = new URLSearchParams(window.location.search);
		if (hash.get("type") === "invite" && hash.get("access_token"))
			setInvite({ accessToken: hash.get("access_token")! });
		else if (query.get("type") === "invite" && query.get("token_hash"))
			setInvite({ tokenHash: query.get("token_hash")! });
		else if (hash.get("error") || hash.get("error_description"))
			setLinkExpired(true);
		history.replaceState(null, "", window.location.pathname);
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		setError("");
		const fd = new FormData(e.target as HTMLFormElement);
		const result = await login(fd);
		if (result?.error) setError(result.error);
	}

	async function handleSetPassword(e: Event) {
		e.preventDefault();
		setError("");
		const fd = new FormData(e.target as HTMLFormElement);
		if (fd.get("password") !== fd.get("confirm")) {
			setError("Passwords don't match.");
			return;
		}
		// Success path throws redirect("/portal") server-side; the router follows it.
		const result = await setPassword(fd);
		if (result?.error) setError(result.error);
	}

	return (
		<div class="login-shell">
			<Title>Client Login — Mad Cactus</Title>
			<div
				class="card"
				style={{
					width: "100%",
					"max-width": "400px",
					padding: "40px",
					"margin": "20px",
				}}
			>
				<div style={{ display: "flex", "align-items": "center", gap: "12px", "margin-bottom": "32px" }}>
					<img src="/cactus-seal.svg" alt="Mad Cactus" style={{ width: "40px", height: "40px" }} />
					<div>
						<div style={{ "font-family": "var(--font-serif)", "font-size": "20px" }}>Mad Cactus</div>
						<div style={{ "font-family": "var(--font-sans)", "font-size": "9px", "letter-spacing": "1.5px", "text-transform": "uppercase", color: "var(--text-subtle)" }}>Client Portal</div>
					</div>
				</div>

				<Show when={invite()}>
					<h1 style={{ "font-family": "var(--font-serif)", "font-size": "22px", "margin-bottom": "8px" }}>Set your password</h1>
					<p class="muted" style={{ "margin-bottom": "24px", "font-size": "14px" }}>
						You've been invited to the Mad Cactus client portal. Choose a password to activate your account.
					</p>
					<form onSubmit={handleSetPassword}>
						<input type="hidden" name="access_token" value={invite()!.accessToken ?? ""} />
						<input type="hidden" name="token_hash" value={invite()!.tokenHash ?? ""} />
						<div class="form-group">
							<label for="new-password">New password</label>
							<input
								type="password"
								id="new-password"
								name="password"
								required
								minlength="6"
								autocomplete="new-password"
								placeholder="At least 6 characters"
							/>
						</div>
						<div class="form-group">
							<label for="confirm-password">Confirm password</label>
							<input
								type="password"
								id="confirm-password"
								name="confirm"
								required
								minlength="6"
								autocomplete="new-password"
								placeholder="••••••••"
							/>
						</div>
						<Show when={error()}>
							<p class="login-error">{error()}</p>
						</Show>
						<button type="submit" class="btn btn-primary" style={{ width: "100%", "margin-top": "8px" }}>
							Set password & continue
						</button>
					</form>
				</Show>

				<Show when={linkExpired()}>
					<h1 style={{ "font-family": "var(--font-serif)", "font-size": "22px", "margin-bottom": "8px" }}>Invite link expired</h1>
					<p class="muted" style={{ "margin-bottom": "24px", "font-size": "14px" }}>
						This invite link is invalid or has expired. Ask us to resend the invite email.
					</p>
					<Show when={error()}>
						<p class="login-error">{error()}</p>
					</Show>
				</Show>

				<Show when={!invite() && !linkExpired()}>
					<h1 style={{ "font-family": "var(--font-serif)", "font-size": "22px", "margin-bottom": "8px" }}>Sign in</h1>
					<p class="muted" style={{ "margin-bottom": "24px", "font-size": "14px" }}>
						Access your project documents, invoices, and status.
					</p>
					<form onSubmit={handleSubmit}>
						<div class="form-group">
							<label for="email">Email</label>
							<input
								type="email"
								id="email"
								name="email"
								required
								autocomplete="email"
								placeholder="you@company.com"
							/>
						</div>
						<div class="form-group">
							<label for="password">Password</label>
							<input
								type="password"
								id="password"
								name="password"
								required
								autocomplete="current-password"
								placeholder="••••••••"
							/>
						</div>
						<Show when={error()}>
							<p class="login-error">{error()}</p>
						</Show>
						<button type="submit" class="btn btn-primary" style={{ width: "100%", "margin-top": "8px" }}>
							Sign in
						</button>
					</form>
				</Show>
			</div>
		</div>
	);
}
