export interface ScoreData {
    tier: string;
    pct: number;
    tierDesc: string;
    annualCost: number;
    employeeCount: number;
    wastePct: number;
    categories: [string, number, number][];
}

export type ContentBlock =
    | { type: "text"; content: string }
    | { type: "code"; label?: string; content: string }
    | { type: "mcp"; name: string; url: string };

export interface CategoryContent {
    key: string;
    label: string;
    whatIs: string;
    blocks: ContentBlock[];
    firstStep: string;
}

export const CATEGORY_CONTENT: Record<string, CategoryContent> = {
    documents: {
        key: "documents",
        label: "Document Creation",
        whatIs:
            "Your team writes proposals, reports, and contracts from scratch every time. The knowledge of what goes in each document lives in someone's head, not in a system.",
        blocks: [
            {
                type: "text",
                content:
                    "Start by gathering your best past examples: the proposals that won, the contracts that closed, the reports clients loved. Store them in a shared folder your AI can access. If you are a Microsoft shop, that is SharePoint or OneDrive. If you are a Google shop, that is Google Drive.",
            },
            {
                type: "mcp",
                name: "SharePoint MCP Server",
                url: "github.com/DEmodoriGatsuO/sharepoint-mcp",
            },
            {
                type: "code",
                label: "Claude Desktop config (SharePoint)",
                content: [
                    '{',
                    '  "mcpServers": {',
                    '    "sharepoint": {',
                    '      "command": "python",',
                    '      "args": ["/path/to/sharepoint-mcp/server.py"],',
                    '      "env": {',
                    '        "TENANT_ID": "your-azure-tenant-id",',
                    '        "CLIENT_ID": "your-app-client-id",',
                    '        "CLIENT_SECRET": "your-app-client-secret",',
                    '        "SITE_URL": "https://yourorg.sharepoint.com/sites/yoursite"',
                    '      }',
                    '    }',
                    '  }',
                    '}',
                ].join("\n"),
            },
            {
                type: "mcp",
                name: "Google Drive MCP (official remote)",
                url: "developers.google.com/workspace/drive/api/guides/configure-mcp-server",
            },
            {
                type: "code",
                label: "Google Drive — Claude Desktop setup",
                content: [
                    "# No config file needed. In Claude Desktop:",
                    "# Settings → Connectors → Add Custom Connector",
                    "# URL: https://drivemcp.googleapis.com/mcp/v1",
                    "# Sign in with your Google account when prompted.",
                ].join("\n"),
            },
            {
                type: "text",
                content:
                    "Once you have 10 to 20 strong examples, you can either paste the documents as context in a Claude project, or use the MCP server to tell Claude to look in that folder for great examples when building similar documents.",
            },
            {
                type: "code",
                label: "Example prompt — draft a proposal",
                content: [
                    "Look in the SharePoint folder 'Past Proposals' for our",
                    "10 most successful proposals. Read through them to",
                    "understand our structure, tone, pricing model, and",
                    "what sections we always include.",
                    "",
                    "Now draft a proposal for: [describe the opportunity,",
                    "client name, scope, and any unique requirements].",
                    "",
                    "Match our voice exactly. Include every section that",
                    "appears in 3+ of the reference proposals.",
                ].join("\n"),
            },
            {
                type: "text",
                content:
                    "The goal is to change the human's job from writer to editor. A good draft that needs 15 minutes of revision beats a blank page that needs 90 minutes of writing.",
            },
        ],
        firstStep:
            "Collect your 10 best proposals into one folder. Paste 3 of them into Claude and ask it to draft a new one from a one-line brief.",
    },

    communication: {
        key: "communication",
        label: "Client Communication",
        whatIs:
            "Every client question gets an individually written response from scratch. The same questions come up repeatedly, but there is no system for capturing and reusing good answers.",
        blocks: [
            {
                type: "text",
                content:
                    "Start by capturing your best responses. When someone writes a great reply to a client question, save it. Build a library of the 20 most common questions and your best answer to each. Store them in SharePoint or Google Drive (see Document Creation section for MCP server setup instructions).",
            },
            {
                type: "text",
                content:
                    "Paste these best responses into a Claude project or use the MCP servers to let Claude search through them as context when a new question arrives.",
            },
            {
                type: "code",
                label: "Example prompt — draft a client reply",
                content: [
                    "Search the 'Client Responses' folder for past replies",
                    "to similar questions. Use the best ones as reference",
                    "for tone, length, and what information we include.",
                    "",
                    "Now draft a reply to this client question:",
                    "[paste the client's email or question]",
                    "",
                    "Match our voice. Keep it concise. Include any",
                    "standard information we always provide.",
                ].join("\n"),
            },
            {
                type: "text",
                content:
                    "For higher volume, a coding agent can build a triage system: incoming emails get classified by topic, matched to the best template, and a draft response is generated automatically. A human reviews and sends. This turns a 20-minute task into a 2-minute task.",
            },
            {
                type: "code",
                label: "Prompt — build a triage system",
                content: [
                    "Build an email triage system that:",
                    "1. Reads incoming emails from our shared inbox",
                    "2. Classifies each by topic (billing, support, sales,",
                    "   general inquiry)",
                    "3. Matches to the best template in our response library",
                    "4. Generates a draft reply using Claude",
                    "5. Routes to the right person for review",
                    "",
                    "Ask me about our email provider, ticketing system,",
                    "and how routing currently works before building.",
                ].join("\n"),
            },
        ],
        firstStep:
            "Collect the 10 most common client questions. Write your best answer for each. That is your first training set.",
    },

    knowledge: {
        key: "knowledge",
        label: "Knowledge Management",
        whatIs:
            "Critical information is scattered across email, Slack, shared drives, and individual employees' heads. When someone needs an answer, they dig. When someone leaves, knowledge walks out the door.",
        blocks: [
            {
                type: "text",
                content:
                    "The end state is a company brain: a single, searchable knowledge base that pulls from all your tools and lets every employee ask questions in plain English. Each person sees only what they are allowed to see.",
            },
            {
                type: "mcp",
                name: "GBrain — Company Brain",
                url: "github.com/garrytan/gbrain",
            },
            {
                type: "code",
                label: "GBrain setup (Claude Code or Codex)",
                content: [
                    "# Install GBrain and create a local brain",
                    "bun install -g github:garrytan/gbrain",
                    "gbrain init --pglite",
                    "",
                    "# Connect to your coding agent",
                    "claude mcp add gbrain -- gbrain serve",
                    "",
                    "# Verify it works",
                    "gbrain doctor",
                ].join("\n"),
            },
            {
                type: "text",
                content:
                    "GBrain is a knowledge layer that sits on top of Postgres or a local PGLite database. It ingests documents, meeting notes, emails, and conversations, then builds a searchable graph of people, companies, and ideas. You query it in plain English and get synthesized answers with citations, not just raw search results.",
            },
            {
                type: "text",
                content:
                    "For a company deployment, each person gets their own slice of the brain, scoped by login. When you query, you only see what your role permits. Fine-grained access control is built in: not everyone should see HR documents, client financials, or strategic plans.",
            },
            {
                type: "code",
                label: "Prompt — set up GBrain for your company",
                content: [
                    "I want to set up GBrain as a company knowledge base.",
                    "Interview me about:",
                    "1. What data sources to connect (Slack, email, Drive,",
                    "   Notion, CRM, etc.)",
                    "2. Which teams need access",
                    "3. What data is sensitive and needs restricted access",
                    "",
                    "Then:",
                    "- Install GBrain with Postgres backend",
                    "- Build connectors for each data source I listed",
                    "- Set up OAuth with scoped per-team access",
                    "- Deploy on a host we can all reach",
                    "- Connect it to our Claude Desktop / Claude Code",
                    "",
                    "Full setup guide: github.com/garrytan/gbrain",
                    "Company brain tutorial: docs/tutorials/company-brain.md",
                ].join("\n"),
            },
            {
                type: "text",
                content:
                    "Start with one person testing it internally. Get it working with one or two data sources. Then add the next source, then the next team member. Once it is stable, host it so the whole company can reach it.",
            },
        ],
        firstStep:
            "Install GBrain locally. Connect it to your most important knowledge source. Ask it a question you normally have to dig for.",
    },

    data: {
        key: "data",
        label: "Data Movement",
        whatIs:
            "Your team spends significant time manually exporting from one system, reformatting, and importing into another. Data lives in silos, and the bridges between them are people doing copy-paste.",
        blocks: [
            {
                type: "text",
                content:
                    "Every manual export-import is a candidate for automation. A coding agent can build a script that pulls data from one system and pushes it to another on a schedule, handling the API connections, data transformation, and error checking.",
            },
            {
                type: "code",
                label: "Prompt — automate data movement",
                content: [
                    "I need to move data between systems automatically.",
                    "Interview me about:",
                    "1. What data needs to move (customer records, orders,",
                    "   financials, inventory, etc.)",
                    "2. Where it comes from and where it needs to go",
                    "3. How often it needs to sync",
                    "",
                    "For each source, investigate:",
                    "- Does it have a public API? Where are the docs?",
                    "- Is it on-premise or cloud-hosted?",
                    "- What authentication does it use?",
                    "- Is there an existing connector or SDK?",
                    "",
                    "Then build a Python pipeline that runs on a schedule,",
                    "with logging and error alerts. Write data to our",
                    "company brain or a Supabase database so other tools",
                    "can access it.",
                ].join("\n"),
            },
            {
                type: "text",
                content:
                    "Be cautious with enterprise tools and on-prem databases. Always test on a copy of the data first. Have the agent build a verification step that confirms every record transferred correctly. If a database has no backup, fix that before connecting anything new to it.",
            },
        ],
        firstStep:
            "List every place your team copies data from one system to another. Pick the most frequent one and ask a coding agent to automate it.",
    },

    reporting: {
        key: "reporting",
        label: "Reporting & Analytics",
        whatIs:
            "Reports are assembled manually: someone pulls numbers from multiple systems, pastes them into a spreadsheet, formats a deck, and repeats the whole process next week.",
        blocks: [
            {
                type: "text",
                content:
                    "Replace the manual assembly cycle with a live dashboard. Your coding agent can build a web dashboard backed by Supabase that pulls from the same data sources you connected in the Data Movement step. No more rebuilding decks.",
            },
            {
                type: "code",
                label: "Prompt — build a reporting dashboard",
                content: [
                    "Build a real-time dashboard for our team.",
                    "",
                    "Look back through our conversation history to see",
                    "what data sources and APIs we have already connected.",
                    "Use those connections.",
                    "",
                    "Interview me about:",
                    "1. What metrics matter most to leadership",
                    "2. What the current weekly report looks like",
                    "3. Who needs access and what they should see",
                    "",
                    "Build it with:",
                    "- Next.js frontend (clean, minimal)",
                    "- Supabase for the database and auth",
                    "- Charts that update automatically",
                    "- Role-based access (not everyone sees everything)",
                    "",
                    "Connect it to our coding agent via an MCP server so",
                    "we can ask questions about the data in plain English.",
                ].join("\n"),
            },
            {
                type: "text",
                content:
                    "Start with one report that your team rebuilds every week. That weekly report is the perfect first dashboard: you already know what data goes in it, who reads it, and you can measure the time saved immediately.",
            },
        ],
        firstStep:
            "Find the report your team rebuilds most often. List every data source it pulls from. That is your first dashboard.",
    },

    onboarding: {
        key: "onboarding",
        label: "Onboarding",
        whatIs:
            "New clients or projects require weeks of manual setup: forms to fill, accounts to configure, documents to collect, checklists to chase.",
        blocks: [
            {
                type: "text",
                content:
                    "An agent can handle the repetitive paperwork. Connect it to Google Workspace or Microsoft 365 via MCP servers (see Document Creation section for config). Once connected, the agent can create folders, generate documents from templates, send welcome emails, and track which steps are complete.",
            },
            {
                type: "code",
                label: "MCP servers for onboarding",
                content: [
                    "# Google Workspace (Drive, Calendar, Gmail)",
                    "# Claude Desktop: Settings → Connectors →",
                    "#   Add Custom Connector",
                    "# URL: https://drivemcp.googleapis.com/mcp/v1",
                    "",
                    "# SharePoint / Microsoft 365",
                    "# See Document Creation section for config",
                    "",
                    "# For local Claude Code:",
                    "claude mcp add gdrive -- npx -y @isaacphi/mcp-gdrive",
                ].join("\n"),
            },
            {
                type: "code",
                label: "Prompt — build an onboarding workflow",
                content: [
                    "I want to automate our client onboarding.",
                    "",
                    "First, interview me about every step:",
                    "1. What forms do we send? (intake, NDA, etc.)",
                    "2. What accounts do we set up?",
                    "3. What documents do we collect from the client?",
                    "4. What emails go out and when?",
                    "5. What internal accounts or folders get created?",
                    "6. What is the kickoff meeting and who joins?",
                    "",
                    "Then build a workflow that:",
                    "- Generates all documents from templates",
                    "- Creates shared folders and grants access",
                    "- Sends the welcome sequence",
                    "- Schedules the kickoff via calendar",
                    "- Tracks completion of each step",
                    "- Notifies the team when the client is fully onboarded",
                ].join("\n"),
            },
            {
                type: "text",
                content:
                    "Start by mapping your current onboarding into a numbered list. Every form, every email, every account setup, every document. That list becomes the agent's instructions. The first time through, watch it work. The second time, trust it. The third time, it is just how you onboard.",
            },
        ],
        firstStep:
            "Write your onboarding process as a numbered checklist. Every step, every form, every email.",
    },

    capacity: {
        key: "capacity",
        label: "Team Capacity",
        whatIs:
            "Your team is stretched thin, turning away work or missing deadlines. You know there is waste, but you cannot see exactly where because no one has mapped what each person actually does all day.",
        blocks: [
            {
                type: "text",
                content:
                    "Before automating anything, you need to know where the time goes. Run a manual audit. Interview each team member about their tasks: what they do, how long it takes, what tools they use, and where the friction is.",
            },
            {
                type: "text",
                content:
                    "Conduct 30-minute interviews with the people who actually do the work. Their managers describe the policy; the doers describe the reality. Ask them to walk through one specific recent case, step by step. Last Tuesday's actual work, not an abstract 'typical day.' Record it.",
            },
            {
                type: "code",
                label: "Interview script — use for each person",
                content: [
                    "AI WORKFLOW AUDIT INTERVIEW",
                    "================================",
                    "",
                    "BEFORE THE INTERVIEW:",
                    "[ ] Confirm the process you will cover",
                    "[ ] Recording tool ready (Otter, Fathom, Granola)",
                    "[ ] 30 min blocked, no interruptions",
                    "",
                    "WARM-UP (3 min):",
                    "[ ] Walk me through your typical day",
                    "[ ] How long in this role?",
                    "",
                    "WALKTHROUGH (15 min) — ONE SPECIFIC RECENT CASE:",
                    "[ ] Walk me through the most recent case, in order",
                    "[ ] What triggered it?",
                    "[ ] First thing you did was...",
                    "[ ] Then what? (follow the thread, do not skip)",
                    "[ ] Who did you hand off to? When?",
                    "[ ] What tools did you open? List every one",
                    "[ ] Where did you copy-paste between systems?",
                    "[ ] What did you build yourself (spreadsheet,",
                    "    script, template) to make this work?",
                    "",
                    "EXCEPTIONS (8 min):",
                    "[ ] When does this not go to plan?",
                    "[ ] What happens 1 time in 10?",
                    "[ ] Ever redo a step because of upstream error?",
                    "",
                    "KPIs (2 min):",
                    "[ ] How long does the whole process take?",
                    "[ ] How many per week?",
                    "[ ] Which step takes the most active work time?",
                    "",
                    "WISHLIST (2 min):",
                    "[ ] What would you change?",
                    "[ ] Most painful step?",
                    "",
                    "AFTER (within 24h):",
                    "[ ] Transcribe the recording",
                    "[ ] List every tool mentioned",
                    "[ ] List every workaround / manual step",
                    "[ ] List every copy-paste or re-keying",
                    "[ ] Note time estimates for each step",
                ].join("\n"),
            },
            {
                type: "text",
                content:
                    "Every spreadsheet someone built to survive a broken system is both a documented pain point and a prototype solution. Score every task on time impact and automation difficulty. The high-impact, low-effort tasks are your quick wins.",
            },
            {
                type: "code",
                label: "Prompt — analyze interviews and find automation",
                content: [
                    "Here are transcripts from workflow interviews",
                    "with my team. For each transcript:",
                    "",
                    "1. Extract every recurring task",
                    "2. Note the tools, inputs, and outputs",
                    "3. Flag every manual step, copy-paste, and",
                    "   workaround",
                    "4. Estimate time spent per task per week",
                    "5. Score each task:",
                    "   - Impact: how much time it eats (1-5)",
                    "   - Effort: how hard to automate (1-5)",
                    "6. Rank the top 10 automation opportunities",
                    "7. For each, describe what the AI tool would do",
                    "   and what data it needs",
                    "",
                    "Output a prioritized roadmap: quick wins first,",
                    "then foundational investments, then strategic plays.",
                ].join("\n"),
            },
        ],
        firstStep:
            "Interview your busiest team member. Ask them to walk through one recent task, step by step. Record it.",
    },

    ai: {
        key: "ai",
        label: "AI Adoption",
        whatIs:
            "Your team is either not using AI at all, or a few people are experimenting on their own with no strategy. There is no coordinated approach, no shared learning, and no way to measure whether AI is actually helping.",
        blocks: [
            {
                type: "text",
                content:
                    "Start with one workflow. Pick the single biggest bottleneck you found in your capacity audit. Build one AI tool for it. One tool, solving one problem, used by one team.",
            },
            {
                type: "text",
                content:
                    "Roll it out like a product, because that is what it is. Track adoption: are people using it? Talk to the users: what is working, what is broken? Iterate based on feedback. The first version will be wrong in some way. Fix it. The second version will be closer.",
            },
            {
                type: "text",
                content:
                    "The most important indicator of whether AI is sticking in your company is whether people are generating deliverables that can be reused across sessions. If someone builds a reusable template, a saved prompt, or an automated workflow, that is sticky. That proves AI is having a real impact.",
            },
            {
                type: "code",
                label: "Prompt — find your first AI project",
                content: [
                    "I want to identify the best first AI project",
                    "for my company. Interview me about:",
                    "",
                    "1. Which teams are most stressed or behind?",
                    "2. Which tasks take the most manual time?",
                    "3. Where are we turning away work or missing",
                    "   deadlines?",
                    "4. What did the workflow audit reveal as the",
                    "   biggest pain points?",
                    "5. Which team is most open to trying new tools?",
                    "",
                    "I have attached the interview transcripts from",
                    "our workflow audit. Use those as primary data.",
                    "",
                    "Recommend ONE workflow to automate first.",
                    "Explain why, what the tool would do, what data",
                    "it needs, and how to measure success.",
                    "",
                    "Then outline a 30-day rollout plan:",
                    "- Week 1: Build and test internally",
                    "- Week 2: Ship to one team, gather feedback",
                    "- Week 3: Iterate based on feedback",
                    "- Week 4: Measure adoption and impact",
                ].join("\n"),
            },
            {
                type: "text",
                content:
                    "Track adoption through a Claude Teams or ChatGPT Teams setup, which gives you visibility into usage patterns across the company. Do interviews with team members about their AI usage. Listen for the word 'template' or 'workflow.' That means they are building reusable assets, and AI is sticking.",
            },
            {
                type: "text",
                content:
                    "As your company grows, the tool will need to grow too. New data sources, new team members, new edge cases. Treat it as living software. Assign one person to own it, gather feedback, and push updates. Once the first tool is working and the team trusts it, add the next one.",
            },
        ],
        firstStep:
            "Pick the single most painful, most repetitive task in your business. Build one AI tool for it. Ship it this month.",
    },
};

export const CAT_LABELS: Record<string, string> = Object.fromEntries(
    Object.values(CATEGORY_CONTENT).map((c) => [c.key, c.label]),
);
