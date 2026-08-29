import Link from "next/link";
import { notFound } from "next/navigation";
import { getCountryByCode } from "@/lib/data";

type StoryPageProps = {
  params: {
    code: string;
  };
};

export default function StoryPage({ params }: StoryPageProps) {
  const country = getCountryByCode(params.code);

  if (!country) {
    notFound();
  }

  return (
    <main className="snap-y snap-mandatory overflow-y-auto bg-ink text-mist">
      <section className="relative flex min-h-screen snap-start items-end overflow-hidden px-6 py-12 sm:px-10 lg:px-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(212,177,106,0.18),transparent_30%),linear-gradient(135deg,rgba(20,48,79,0.95),rgba(8,17,31,1))]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink to-transparent" />

        <Link
          href="/"
          className="absolute left-6 top-6 z-10 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm text-mist transition hover:bg-white/10 sm:left-10 sm:top-10"
        >
          Back to globe
        </Link>

        <div className="relative z-10 mx-auto max-w-4xl">
          <p className="text-xs uppercase tracking-[0.4em] text-gold/80">
            {country.name}
          </p>
          <h1 className="mt-4 font-display text-5xl leading-none sm:text-7xl">
            {country.eraLabel}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-mist/82">
            {country.eraRationale}
          </p>
          <p className="mt-10 text-sm uppercase tracking-[0.3em] text-mist/58">
            Scroll to move through six defining moments
          </p>
        </div>
      </section>

      {country.moments.map((moment) => (
        <section
          key={moment.id}
          className="relative flex min-h-screen snap-start items-end overflow-hidden"
        >
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${moment.imagePath})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/10" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,transparent_40%,rgba(0,0,0,0.35)_100%)]" />

          <div className="relative z-10 w-full px-6 pb-10 pt-24 sm:px-10 sm:pb-16 lg:px-16">
            <div className="max-w-3xl rounded-[2rem] border border-white/15 bg-black/30 p-6 shadow-glow backdrop-blur-md sm:p-8">
              <p className="text-sm uppercase tracking-[0.35em] text-gold/80">
                {moment.year}
              </p>
              <h2 className="mt-4 font-display text-3xl sm:text-5xl">
                {moment.factText}
              </h2>
              <p className="mt-6 max-w-2xl text-base leading-8 text-mist/84 sm:text-lg">
                {moment.narrativeCopy}
              </p>
              <p className="mt-8 text-xs uppercase tracking-[0.28em] text-mist/55">
                {moment.sourceRef}
              </p>
            </div>
          </div>
        </section>
      ))}
    </main>
  );
}
