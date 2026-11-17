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
 * Status: header only; not implemented.
 */
