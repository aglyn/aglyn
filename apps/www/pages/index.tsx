import Head from 'next/head'


const year = new Date().getFullYear()

export default function Index() {
  return (
    <div className="container">
      <Head>
        <title>Aglyn</title>
        <meta
          name="description"
          content="Contributions to the “no code” web application market by optimizing the process and necessary steps for a website to get off the ground for organizations"
        />
      </Head>

      <main>
        <img src="/favicon.svg" alt="Aglyn Logo" className="icon-header" />
        <img src="/brand/logo.svg" alt="Aglyn Logo" className="logo-header" />

        <h1 className="title">
          Welcome to <a href="https://aglyn.com">Aglyn.com!</a>
        </h1>

        <p className="description">
          All details and information are <code>underway</code>
        </p>

        <div className="grid">

          <div className="card">
            <h3>Deploy &rarr;</h3>
            {/* <p>Instantly deploy your Next.js site to a public URL with Vercel.</p> */}
          </div>

          <div className="card">
            <h3>Example &rarr;</h3>
            {/* <p>Discover and deploy boilerplate example Next.js projects.</p> */}
          </div>

          <div className="card">
            <h3>Document &rarr;</h3>
            {/* <p>Find in-depth information about Next.js features and API.</p> */}
          </div>

          <div className="card">
            <h3>Learn &rarr;</h3>
            {/* <p>Learn about Next.js in an interactive course with quizzes!</p> */}
          </div>

        </div>
      </main>

      <footer>
        <div>
          <a href="https://aglyn.com">
            <img src="/brand/logo.svg" alt="Aglyn Logo" className="logo" />
          </a>
        </div>
        <br />
        <div className="copy">
          &copy; {year} Aglyn LLC.
        </div>
      </footer>

      <style jsx>{`
        .container {
          min-height: 100vh;
          padding: 0 0.5rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }

        main {
          padding: 5rem 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }

        footer {
          width: 100%;
          height: 100px;
          border-top: 1px solid #eaeaea;
          display: flex;
          justify-content: center;
          align-items: center;
          flex-direction: column;
        }

        footer img {
          // margin-left: 0.5rem;
        }

        footer a {
          display: flex;
          justify-content: center;
          align-items: center;
        }


        a {
          color: inherit;
          text-decoration: none;
        }

        .title a {
          color: #0070f3;
          text-decoration: none;
        }

        .title a:hover,
        .title a:focus,
        .title a:active {
          text-decoration: underline;
        }

        .title {
          margin: 0;
          line-height: 1.15;
          font-size: 4rem;
        }

        .title,
        .description {
          text-align: center;
        }

        .description {
          line-height: 1.5;
          font-size: 1.5rem;
        }

        code {
          background: #fafafa;
          border-radius: 5px;
          padding: 0.75rem;
          font-size: 1.1rem;
          font-family: Menlo, Monaco, Lucida Console, Liberation Mono,
          DejaVu Sans Mono, Bitstream Vera Sans Mono, Courier New, monospace;
        }

        .grid {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;

          max-width: 800px;
          margin-top: 3rem;
        }

        .card {
          margin: 1rem;
          flex-basis: 45%;
          padding: 1.5rem;
          text-align: left;
          color: inherit;
          text-decoration: none;
          border: 1px solid #eaeaea;
          border-radius: 10px;
          transition: color 0.15s ease, border-color 0.15s ease;
        }

        .card:hover,
        .card:focus,
        .card:active {
          color: #0070f3;
          border-color: #0070f3;
        }

        .card h3 {
          margin: 0 0 1rem 0;
          font-size: 1.5rem;
        }

        .card p {
          margin: 0;
          font-size: 1.25rem;
          line-height: 1.5;
        }

        .icon-header {
          height: 6em;
          margin-bottom: 16px;
        }

        .logo-header {
          height: 6em;
          margin-bottom: 64px;
        }

        .logo {
          height: 1em;
        }

        .copy {
          color: #a1a1a1;
          font-size: 12px !important;
        }

        @media (max-width: 600px) {
          .grid {
            width: 100%;
            flex-direction: column;
          }
        }
      `}</style>

      <style jsx global>{`
        html,
        body {
          padding: 0;
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto,
          Oxygen, Ubuntu, Cantarell, Fira Sans, Droid Sans, Helvetica Neue,
          sans-serif;
        }

        * {
          box-sizing: border-box;
        }
      `}</style>
    </div>
  )
}
