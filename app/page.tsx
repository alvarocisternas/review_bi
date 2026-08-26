import AppSearch from "./components/AppSearch";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
          Benchmark Review Intelligence
        </h1>
        <AppSearch />
      </main>
    </div>
  );
}
