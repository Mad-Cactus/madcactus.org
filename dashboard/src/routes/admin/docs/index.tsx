import { Title } from "@solidjs/meta";
import Layout from "~/components/Layout";
import DocList from "~/components/DocList";

export default function AdminDocs() {
	return (
		<Layout>
			<Title>Docs — Mad Cactus</Title>
			<DocList
				kind={null}
				title="Docs"
				subtitle="Internal markdown — pure text, version history, agents write and your edits teach"
				createPlaceholder="New doc title…"
			/>
		</Layout>
	);
}
