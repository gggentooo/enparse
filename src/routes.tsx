/**
 * src/routes.tsx — route definitions
 *
 * Description:
 *   Creates the app's hash router (createHashRouter). App is the root route;
 *   pages render inside ContentArea's <Outlet />.
 *
 * Tasks:
 *   1. Root route: element <App />.
 *   2. Child routes: #/input → InputPage, #/output → OutputPage,
 *      #/vocab → VocabPage, #/dictionary → DictionaryPage,
 *      #/models → ModelsPage (model library).
 *   3. Index route redirects to #/input (proposed).
 *   4. Fallback route for unknown paths (redirect to #/input) (proposed).
 *   5. Export `router` (named export).
 *
 * Dependencies:
 *   External: react-router-dom.
 *   Internal: components/App.tsx, components/Pages/*.tsx, ./paths.ts.
 *   Used by: src/main.tsx. Kept in sync with components/Layout/Sidebar.tsx links.
 *
 * Status: implemented (T39). #/about added for T21 (page built in T50).
 */

import { Navigate, type RouteObject, createHashRouter } from "react-router";
import { App, RouteError } from "./components/App";
import { AboutPage } from "./components/Pages/AboutPage";
import { DictionaryPage } from "./components/Pages/DictionaryPage";
import { InputPage } from "./components/Pages/InputPage";
import { ModelsPage } from "./components/Pages/ModelsPage";
import { OutputPage } from "./components/Pages/OutputPage";
import { VocabPage } from "./components/Pages/VocabPage";
import { PATHS } from "./paths";

/** Route tree (exported for tests with a memory router). */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to={PATHS.input} replace /> },
      { path: PATHS.input, element: <InputPage /> },
      { path: PATHS.output, element: <OutputPage /> },
      { path: PATHS.vocab, element: <VocabPage /> },
      { path: PATHS.dictionary, element: <DictionaryPage /> },
      { path: PATHS.models, element: <ModelsPage /> },
      { path: PATHS.about, element: <AboutPage /> },
      { path: "*", element: <Navigate to={PATHS.input} replace /> },
    ],
  },
];

/** The app's hash router (works on any static host). */
export const router = createHashRouter(routes);
