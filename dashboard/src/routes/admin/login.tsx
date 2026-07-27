import { Title } from "@solidjs/meta";
import { createAsync, useAction } from "@solidjs/router";
import { Show, createSignal } from "solid-js";
import { getUserQuery, loginAction } from "~/lib/queries";

export default function Login() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const login = useAction(loginAction);
	const [error, setError] = createSignal("");
	const [loading, setLoading] = createSignal(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		setError("");
		setLoading(true);
		const fd = new FormData(e.target as HTMLFormElement);
		const result = await login(fd);
		setLoading(false);
		if (result?.error) setError(result.error);
	}

	return (
		<Show
			when={user()}
			fallback={
				<div class="login-shell">
					<Title>Login — Mad Cactus</Title>
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
								<div style={{ "font-family": "var(--font-sans)", "font-size": "9px", "letter-spacing": "1.5px", "text-transform": "uppercase", color: "var(--text-subtle)" }}>Portal</div>
							</div>
						</div>
						<h1 style={{ "font-family": "var(--font-serif)", "font-size": "22px", "margin-bottom": "8px" }}>Sign in</h1>
						<p class="muted" style={{ "margin-bottom": "24px", "font-size": "14px" }}>
							Sign in to access your dashboard.
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
							<button type="submit" class="btn btn-primary" style={{ width: "100%", "margin-top": "8px" }} disabled={loading()}>
								{loading() ? "Signing in…" : "Sign in"}
							</button>
						</form>
					</div>
				</div>
			}
		>
			<script>window.location.href = "/admin"</script>
		</Show>
	);
}
