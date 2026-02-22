import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from 'react-router'
import type { Route } from './+types/root'
import './app.css'
import type { LoaderFunctionArgs } from 'react-router'
import { getSessionUser } from '~/services/auth.server'
import { getDb, schema } from '~/db/db.server'
import { eq } from 'drizzle-orm'

const REQUIRED_ENV_VARS = ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'DATABASE_URL']

export async function loader({ request }: LoaderFunctionArgs) {
  const missingEnvVars = REQUIRED_ENV_VARS.filter(key => !process.env[key])

  let theme = 'light'
  const user = await getSessionUser(request)
  if (user) {
    const db = await getDb()
    const prefRows = await db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, user.id))
      .limit(1)
    if (prefRows[0]?.theme) {
      theme = prefRows[0].theme
    }
  }

  return { missingEnvVars, theme }
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>('root')
  const theme = data?.theme ?? 'light'

  return (
    <html lang="en" data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>qaos — An Open Source AI QA Co-founder</title>
        <meta name="description" content="Conversational agentic testing platform" />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App({ loaderData }: Route.ComponentProps) {
  const { missingEnvVars } = loaderData

  return (
    <>
      {missingEnvVars && missingEnvVars.length > 0 && (
        <div className="fixed top-0 right-0 left-0 z-50 bg-red-600 px-4 py-2 text-center text-sm font-medium text-white shadow-md">
          ⚠️ Missing Required Environment Variables in{' '}
          <code className="rounded bg-red-800 px-1">.env</code>: {missingEnvVars.join(', ')}
        </div>
      )}
      <div className={missingEnvVars && missingEnvVars.length > 0 ? 'pt-9' : ''}>
        <Outlet />
      </div>
    </>
  )
}
