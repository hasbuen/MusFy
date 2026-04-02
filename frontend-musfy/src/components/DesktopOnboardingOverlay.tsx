export type DesktopOnboardingStep = {
  id: string;
  title: string;
  description: string;
  accent: string;
};

type Props = {
  step: DesktopOnboardingStep;
  stepIndex: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  onClose: (completed?: boolean) => void;
};

export default function DesktopOnboardingOverlay({
  step,
  stepIndex,
  totalSteps,
  onBack,
  onNext,
  onClose
}: Props) {
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === totalSteps - 1;

  return (
    <div className="pointer-events-none fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-[rgba(4,8,12,0.78)] backdrop-blur-[4px]" />

      <div className="pointer-events-auto absolute bottom-8 right-8 w-full max-w-[440px] overflow-hidden rounded-[34px] border border-cyan-300/20 bg-[#071019]/95 shadow-[0_30px_90px_rgba(0,0,0,0.48)]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-cyan-300/12 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-10 h-32 w-32 rounded-full bg-emerald-300/10 blur-3xl" />

        <div className="relative border-b border-white/8 bg-gradient-to-br from-cyan-300/8 via-white/[0.04] to-transparent px-6 pb-5 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-200">
                  Tutorial do MusFy
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-400">
                  Etapa {stepIndex + 1}
                </span>
              </div>
              <h3 className="mt-4 text-[30px] font-black leading-none tracking-tight text-white">
                {step.title}
              </h3>
            </div>

            <button
              type="button"
              onClick={() => onClose(false)}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-gray-300 transition hover:bg-white/[0.08] hover:text-white"
            >
              Fechar
            </button>
          </div>

          <p className="mt-4 max-w-[34ch] text-sm leading-7 text-gray-300">{step.description}</p>

          <div className="mt-5 flex flex-wrap gap-2">
            {Array.from({ length: totalSteps }, (_, index) => (
              <span
                key={index}
                className={`h-2 rounded-full transition-all ${
                  index === stepIndex ? 'w-10 bg-cyan-300' : 'w-2 bg-white/14'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="relative px-6 pb-6 pt-5">
          <div className="rounded-[26px] border border-white/10 bg-black/20 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gray-500">Foco atual</p>
            <p className="mt-2 text-base font-semibold text-white">{step.accent}</p>
            <p className="mt-3 text-sm leading-6 text-gray-400">
              Use esta etapa para localizar mais rapido a area destacada e entender o fluxo antes de comecar a usar o app no dia a dia.
            </p>
          </div>

          <div className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.22em] text-gray-500">
              <span>Progresso</span>
              <span>
                {stepIndex + 1}/{totalSteps}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-400 via-emerald-300 to-cyan-300 transition-all"
                style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
              />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onBack}
              disabled={isFirstStep}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-gray-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Voltar
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onClose(true)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-gray-200 transition hover:bg-white/[0.08]"
              >
                Pular e salvar
              </button>
              <button
                type="button"
                onClick={onNext}
                className="rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-[#061018] transition hover:bg-cyan-200"
              >
                {isLastStep ? 'Concluir tutorial' : 'Proximo'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
