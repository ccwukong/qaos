import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import { getDb, schema } from "~/db/db.server";
import { eq } from "drizzle-orm";
import "./app.css";

const REQUIRED_ENV_VARS = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "HEADLESS",
  "DISABLE_SCREENSHOTS",
  "DATABASE_URL",
  "TEST_USER",
  "TEST_USER_PASSWORD",
];

export async function loader() {
  const db = getDb();
  const themeRow = db.select().from(schema.config).where(eq(schema.config.key, "theme")).get();
  
  const missingEnvVars = REQUIRED_ENV_VARS.filter(key => !process.env[key]);

  return { 
    theme: themeRow?.value ?? "light",
    missingEnvVars,
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>qaos Studio</title>
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
        {/* Theme hydration script — runs before paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = document.cookie.match(/qaos-theme=(light|dark|system)/)?.[1] || 'light';
                document.documentElement.setAttribute('data-theme', theme);
              } catch {}
            `,
          }}
        />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const { missingEnvVars } = loaderData;

  return (
    <>
      {missingEnvVars && missingEnvVars.length > 0 && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-2 text-sm font-medium text-center shadow-md">
          ⚠️ Missing Required Environment Variables in <code className="bg-red-800 px-1 rounded">.env</code>: {missingEnvVars.join(", ")}
        </div>
      )}
      <div className={missingEnvVars && missingEnvVars.length > 0 ? "pt-9" : ""}>
        <Outlet />
      </div>
    </>
  );
}
