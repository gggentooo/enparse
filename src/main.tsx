/**
 * src/main.tsx — application entry point
 *
 * Description:
 *   Mounts the React app: creates the root on #root in index.html and renders
 *   <RouterProvider> with the hash router from routes.tsx.
 *
 * Tasks:
 *   1. Import css/tokens.css and css/global.css (only place global CSS is loaded).
 *   2. createRoot(document.getElementById('root')) inside <React.StrictMode>.
 *   3. Render <RouterProvider router={router} />.
 *   4. Throw a clear error if #root is missing.
 *
 * Dependencies:
 *   External: react, react-dom/client, react-router-dom.
 *   Internal: src/routes.tsx, src/css/tokens.css, src/css/global.css.
 *   Loaded by: src/index.html.
 *
 * Status: implemented (T39; language restore T68; service worker T69).
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import "./css/tokens.css";
import "./css/global.css";
import { router } from "./routes";
import { appUpdateService } from "./services/appUpdateService";
import { languageService } from "./services/languageService";

// Restore the saved UI language (T68); the default (Korean) shows until then.
void languageService().restore();
// Offline app shell and update prompt (T69; production builds only).
void appUpdateService().start();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("index.html is missing the #root element");

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
