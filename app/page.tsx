import AppSearch from "./components/AppSearch";
import AppCarousel from "./components/AppCarousel";
import ThemeToggle from "./components/ThemeToggle";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppCarousel />
      <div className="my-4 flex justify-center">
        <ThemeToggle />
      </div>
      <div className="px-6 py-16">
        <main className="mx-auto flex w-full max-w-xl flex-col gap-6">
          <h1 className="text-center text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
            Benchmark Review Intelligence 🇨🇱
          </h1>
          <AppSearch />
        </main>
      </div>
    </div>
  );
}
