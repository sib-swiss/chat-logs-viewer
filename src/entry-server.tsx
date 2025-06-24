// @refresh reload
import {createHandler, StartServer} from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({assets, children, scripts}) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/logo.png" />
          <title>Chat Logs Viewer</title>
          <meta property="og:title" content="Chat Logs Viewer" />
          <meta name="description" content="Basic webapp to visually explore conversation logs." />
          <meta property="og:description" content="Basic webapp to visually explore conversation logs." />
          <meta property="og:image" content="logo.png" />
          <meta name="author" content="SIB Swiss Institute of Bioinformatics" />
          <meta name="keywords" content="Logs" />
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
