// Fanger blant annet mislykket lasting av lazy-chunker (tapt nett midt i en økt).
export default function RouteError() {
  return (
    <main className="container">
      <h1>Noe gikk galt</h1>
      <p>Siden kunne ikke vises.</p>
      <p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Last siden på nytt
        </button>
      </p>
    </main>
  );
}
