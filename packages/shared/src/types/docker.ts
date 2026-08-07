export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: Array<{ privatePort: number; publicPort?: number; type: string }>;
  createdAt: string;
  cpuPercent?: number;
  memUsageBytes?: number;
  memLimitBytes?: number;
}

export interface ContainerDetail extends ContainerSummary {
  command: string;
  env: string[];
  mounts: Array<{ source: string; destination: string; mode: string }>;
  networkMode: string;
  restartPolicy: string;
}

export interface ImageSummary {
  id: string;
  tags: string[];
  sizeBytes: number;
  createdAt: string;
}

export interface VolumeSummary {
  name: string;
  driver: string;
  mountpoint: string;
  sizeBytes?: number;
}

export interface NetworkSummary {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export interface DockerSystemDf {
  containersSizeBytes: number;
  imagesSizeBytes: number;
  volumesSizeBytes: number;
  reclaimableBytes: number;
}
