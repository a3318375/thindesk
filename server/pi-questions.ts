// Pi extension: the model can ask a real question instead of embedding a form in text.
// Uses plain JSON schema; Pi loads this with its own extension loader.
export default function questions(pi: any) {
  pi.registerTool({
    name: "ask_user", label: "询问用户",
    description: "Ask the user to choose an option or provide missing information. Waits for their answer in the web interface.",
    parameters: {
      type: "object", properties: {
        question: { type: "string" },
        options: { type: "array", items: { type: "string" } },
      }, required: ["question"],
    },
    async execute(_id: string, params: { question: string; options?: string[] }, _signal: unknown, _update: unknown, ctx: any) {
      const answer = params.options?.length
        ? await ctx.ui.select(params.question, params.options)
        : await ctx.ui.input(params.question);
      return { content: [{ type: "text", text: answer === undefined ? "用户取消了提问。" : String(answer) }] };
    },
  });
}
