export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">
        This module hasn't been built yet. It will be implemented in a later
        step.
      </p>
    </div>
  );
}
