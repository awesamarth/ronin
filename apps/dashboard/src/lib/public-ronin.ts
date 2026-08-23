const INTRO =
  "I’m Ronin, an agentic solutions engineer. I help teams explain, support, test, and improve their products by connecting customer questions to documentation, repositories, and reviewable fixes.";

export function answerPublicRoninMessage(text: string) {
  const question = text.toLowerCase();

  if (/how (do you|does ronin)|how.*work/.test(question)) {
    return `${INTRO} When an authorized workspace connects a channel and repository, I can investigate questions, run checks, and propose code or documentation changes through pull requests.`;
  }

  if (/access|private|privacy|permission|secure|knowledge/.test(question)) {
    return "This DM is in public mode. I can explain Ronin, but I cannot access any company’s repositories, knowledge, conversations, or tools unless an operator explicitly connects and authorizes this conversation.";
  }

  if (/connect|setup|set up|get started|use ronin/.test(question)) {
    return "To use Ronin with a company, an operator connects its GitHub and Slack workspace, maps approved channels to repositories, and chooses what Ronin may read or change. Until then, this DM stays in public mode.";
  }

  if (/what.*(do|are)|who are you|what is ronin/.test(question)) return INTRO;

  return `${INTRO} This DM is not connected to a company workspace, so I’m in public mode and cannot access private knowledge or repositories. You can ask what I do, how I work, or how to connect Ronin.`;
}
