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
 *      #/vocab → VocabPage, #/dictionary → DictionaryPage.
 *   3. Index route redirects to #/input (proposed).
 *   4. Fallback route for unknown paths (redirect to #/input) (proposed).
 *   5. Export `router` (named export).
 *
 * Dependencies:
 *   External: react-router-dom.
 *   Internal: components/App.tsx, components/Pages/*.tsx.
 *   Used by: src/main.tsx. Kept in sync with components/Layout/Sidebar.tsx links.
 *
 * Status: header only; not implemented.
 */
