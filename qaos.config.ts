export type DeploymentMode = 'single' | 'hybrid'

export interface QaosConfig {
  deploymentMode: DeploymentMode
}

export const qaosConfig: QaosConfig = {
  deploymentMode: 'single',
}
