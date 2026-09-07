// Marketing page shell — wraps every public marketing route. Analytics live
// in entry-server.tsx (ONE PostHog project for all client-facing pages);
// this wrapper only scopes the vellum design system via .mk-root and sets
// per-page meta (see marketing-shared.css).
import { Meta, Title } from "@solidjs/meta";
import type { ParentProps } from "solid-js";
import "~/styles/marketing-shared.css";

export default function MarketingPage(props: ParentProps & { title: string; description: string }) {
	return (
		<div class="mk-root">
			<Title>{props.title}</Title>
			<Meta name="description" content={props.description} />
			{props.children}
		</div>
	);
}
