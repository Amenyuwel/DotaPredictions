// Answers /api/* while no compute server sits behind this Worker.
//
// Without it the SPA fallback serves index.html for /api/run/current with a 200,
// the client's res.json() throws a SyntaxError, and "nothing is listening"
// reaches the reader as "something unknown broke". A 503 is what the client's
// `states.tsx` already reads as unreachable. Replace this with a proxy once the
// Express server has a host.
export default {
  fetch() {
    return Response.json(
      {
        error: "api_not_deployed",
        reason: "The compute server is not deployed yet; this host serves the client only.",
      },
      { status: 503 },
    )
  },
}
