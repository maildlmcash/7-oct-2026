import { recordMissingPage } from "../page-health-server.mjs";

export default function NotFound() {
  const event = recordMissingPage();
  return (
    <main>
      <h1>Page not found</h1>
      <p data-request-id={event.requestId}>{event.requestId}</p>
    </main>
  );
}
