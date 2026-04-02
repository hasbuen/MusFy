import { Pressable, StyleSheet, Text, View } from 'react-native';

export type MobileOnboardingStep = {
  id: string;
  title: string;
  description: string;
  accent: string;
};

type Props = {
  step: MobileOnboardingStep;
  stepIndex: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  onClose: (completed?: boolean) => void;
};

export default function MobileOnboardingOverlay({
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
    <View style={styles.scrim}>
      <View style={styles.card}>
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />

        <View style={styles.header}>
          <View style={styles.headerText}>
            <View style={styles.badgeRow}>
              <Text style={styles.kicker}>Tutorial inicial</Text>
              <Text style={styles.stepBadge}>Etapa {stepIndex + 1}</Text>
            </View>
            <Text style={styles.title}>{step.title}</Text>
          </View>
          <Pressable style={styles.ghostButton} onPress={() => onClose(false)}>
            <Text style={styles.ghostButtonText}>Fechar</Text>
          </Pressable>
        </View>

        <Text style={styles.description}>{step.description}</Text>

        <View style={styles.dotsRow}>
          {Array.from({ length: totalSteps }, (_, index) => (
            <View key={index} style={[styles.dot, index === stepIndex && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.accentCard}>
          <Text style={styles.accentKicker}>Foco atual</Text>
          <Text style={styles.accentText}>{step.accent}</Text>
          <Text style={styles.accentDescription}>
            Este passo chama atencao para a area principal da interface para acelerar a primeira navegacao.
          </Text>
        </View>

        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Progresso</Text>
            <Text style={styles.progressLabel}>
              {stepIndex + 1}/{totalSteps}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((stepIndex + 1) / totalSteps) * 100}%` }]} />
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.secondaryButton, isFirstStep && styles.secondaryButtonDisabled]}
            onPress={onBack}
            disabled={isFirstStep}
          >
            <Text style={styles.secondaryButtonText}>Voltar</Text>
          </Pressable>
          <View style={styles.actionGroup}>
            <Pressable style={styles.secondaryButton} onPress={() => onClose(true)}>
              <Text style={styles.secondaryButtonText}>Pular</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={onNext}>
              <Text style={styles.primaryButtonText}>{isLastStep ? 'Concluir' : 'Proximo'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 8, 12, 0.78)',
    justifyContent: 'flex-end',
    padding: 18
  },
  card: {
    overflow: 'hidden',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#1f3944',
    backgroundColor: '#08111a',
    padding: 18,
    gap: 14
  },
  glowTop: {
    position: 'absolute',
    top: -40,
    right: -20,
    width: 140,
    height: 140,
    borderRadius: 999,
    backgroundColor: 'rgba(42,245,199,0.12)'
  },
  glowBottom: {
    position: 'absolute',
    bottom: -36,
    left: 18,
    width: 100,
    height: 100,
    borderRadius: 999,
    backgroundColor: 'rgba(86,218,255,0.08)'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  headerText: {
    flex: 1,
    gap: 8
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8
  },
  kicker: {
    color: '#2af5c7',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase'
  },
  stepBadge: {
    color: '#94a3af',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#22313a',
    backgroundColor: 'rgba(255,255,255,0.04)'
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900'
  },
  description: {
    color: '#c3cdd6',
    fontSize: 14,
    lineHeight: 22
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#20313a'
  },
  dotActive: {
    width: 32,
    backgroundColor: '#2af5c7'
  },
  accentCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1f2f3a',
    backgroundColor: 'rgba(0,0,0,0.18)',
    padding: 14,
    gap: 8
  },
  accentKicker: {
    color: '#6d7a86',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase'
  },
  accentText: {
    color: '#f5fbff',
    fontSize: 16,
    fontWeight: '700'
  },
  accentDescription: {
    color: '#9ca9b5',
    fontSize: 13,
    lineHeight: 20
  },
  progressCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1d2a33',
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 14,
    gap: 10
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  progressLabel: {
    color: '#7e8a94',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.1
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#15212a',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2af5c7'
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  ghostButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#27343e',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  ghostButtonText: {
    color: '#dbe4ea',
    fontSize: 12,
    fontWeight: '700'
  },
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#27343e',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  secondaryButtonDisabled: {
    opacity: 0.38
  },
  secondaryButtonText: {
    color: '#dbe4ea',
    fontSize: 13,
    fontWeight: '800'
  },
  primaryButton: {
    borderRadius: 999,
    backgroundColor: '#2af5c7',
    paddingHorizontal: 16,
    paddingVertical: 11
  },
  primaryButtonText: {
    color: '#071018',
    fontSize: 13,
    fontWeight: '900'
  }
});
