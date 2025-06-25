import {HttpStatusCode} from "@solidjs/start";

export default function NotFound() {
  return (
    <>
      <HttpStatusCode code={404} />
      <main
        style={{
          display: "flex",
          "flex-direction": "column",
          "text-align": "center",
          padding: "10rem",
        }}
      >
        <h1>Page Not Found</h1>
        <p>The page you're looking for doesn't exist.</p>
      </main>
    </>
  );
}
