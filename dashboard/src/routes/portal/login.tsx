import { Title } from "@solidjs/meta";
import { A, createAsync, useAction } from "@solidjs/router";
import { Show, createSignal } from "solid-js";
import { clientLoginAction } from "~/lib/client-queries";

export default function ClientLogin() {
	const login = useAction(clientLoginAction);
	const [error, setError] = createSignal("");

	async function handleSubmit(e: Event) {
		e.preventDefault();
		setError("");
		const fd = new FormData(e.target as HTMLFormElement);
		const result = await login(fd);
		if (result?.error) setError(result.error);
	}

	return (
		<div
			style={{
				display: "flex",
				"min-height": "100vh",
				"align-items": "center",
				"justify-content": "center",
				background: "#0a0a0a",
			}}
		>
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
				<div class="sidebar-brand" style={{ "margin-bottom": "24px", "font-size": "20px" }}>
					Mad Cactus <span>· Client Portal</span>
				</div>
				<h1 style={{ "font-size": "18px", "margin-bottom": "8px" }}>Sign in</h1>
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
			</div>
		</div>
	);
}
