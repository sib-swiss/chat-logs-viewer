import {HttpStatusCode} from "@solidjs/start";

export default function NotFound() {
  return (
    <>
      <HttpStatusCode code={404} />
      <main
        style={{
          display: "flex",
          "flex-direction": "column",
          "align-items": "center",
          "justify-content": "center",
          // "min-height": "100vh",
          padding: "4rem",
          "text-align": "center",
        }}
      >
        <h1>Page Not Found</h1>
        <p>The page you're looking for doesn't exist.</p>
      </main>
    </>
  );
}
