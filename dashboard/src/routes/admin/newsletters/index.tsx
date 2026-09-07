import { Title } from "@solidjs/meta";
import Layout from "~/components/Layout";
import DocList from "~/components/DocList";

export default function AdminNewsletters() {
	return (
		<Layout>
			<Title>Newsletters — Mad Cactus</Title>
			<DocList
				kind="newsletter"
				title="Newsletters"
				subtitle="Cactus Dispatch issues — preview the email and the web version, then schedule the send"
				createPlaceholder="New issue title…"
			/>
		</Layout>
	);
}
