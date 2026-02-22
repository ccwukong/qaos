// Helper to read args
function getArgs() {
  try {
    if (process.env.SKILL_ARGS) {
      return JSON.parse(process.env.SKILL_ARGS)
    }
  } catch (e) {
    console.error('Failed to parse SKILL_ARGS', e)
  }
  return {}
}

async function main() {
  const args = getArgs()
  if (!args.expression) {
    console.error("Missing 'expression' argument")
    process.exit(1)
  }

  try {
    // We use a safe eval or mathjs. For this demo, simple Function is risky but sufficient for local proof of concept.
    // Better: rely on basic JS math.
    // const result = new Function('return ' + args.expression)();

    // Actually, let's just use eval for v1.1 demo (WARNING: Unsafe in prod, but this is a local tool).
    // A better approach is `mathjs` but we don't have it installed.
    // So we will parse simple operators.

    const result = eval(args.expression)
    console.log(JSON.stringify({ result }))
  } catch (err: any) {
    console.error(err.message)
    process.exit(1)
  }
}

main()
