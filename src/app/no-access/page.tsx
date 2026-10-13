export const metadata = { title: 'Нет доступа' };

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ email?: string; inactive?: string }> }) {
  const { email, inactive } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <div className="card text-center">
        <h1 className="mb-2 text-lg font-bold">Нет доступа</h1>
        <p className="text-slate-700">
          {inactive ? 'Ваша учётная запись отключена.' : 'Вас нет в списке сотрудников, обратитесь к руководителю.'}
        </p>
        {email && <p className="mt-2 text-sm text-slate-500">Почта: {email}</p>}
        <a href="/login" className="btn-secondary mt-5 w-full">Войти под другой почтой</a>
      </div>
    </main>
  );
}
