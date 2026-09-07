import { Title } from "@solidjs/meta";
import { useParams, createAsync } from "@solidjs/router";
import { Show } from "solid-js";
import Layout from "~/components/Layout";
import { DocEditor } from "~/components/DocEditor";
import { getDocQuery } from "~/lib/docs-queries";

export default function AdminDocEditor() {
	const params = useParams();
	const doc = createAsync(() => getDocQuery(params.id ?? ""), { deferStream: true });
	return (
		<Layout>
			<Show when={doc()}>
				{(d) => (
					<>
						<Title>{d().title} — Mad Cactus</Title>
						<DocEditor id={params.id ?? ""} doc={d()} />
					</>
				)}
			</Show>
		</Layout>
	);
}
