type ComposeNetwork = {
  driver?: string
  driver_opts?: Record<string, string>
  attachable?: boolean
  enable_ipv4?: boolean
  enable_ipv6?: boolean
  external?: boolean
  name: string
  ipam: {
    driver?: string
    config?: {
      subnet: string
      ip_range: string
      gateway: string
      aux_addresses: Record<string, string>
    }
  }
  internal?: boolean
  labels?: Record<string, string>
}

type ComposeService = {
  build?: {
    context: string
    dockerfile: string
    args: Record<string, string>
  }
  command: string | string[] | null
  entrypoint: string | string[] | null
  environment?: Record<string, string>
  extra_hosts?: string[]
  image: string | null
  networks: Record<string, null>
  ports?: ComposePort[]
  volumes?: ComposeServiceVolume[]
  sysctls?: Record<string, string>
  annotations?: Record<string, string>
  labels?: Record<string, string>
  label_file?: string[]
  links?: string[]
  attach?: boolean
  cap_add?: string[]
  cap_drop?: string[]
  container_name?: string
  env_file?: string
  expode: string[]
  extends?: {
    file: string
    service: string
  }
  init?: boolean
  hostname?: string
  healthcheck?: {
    disable?: boolean
    test: string | string[]
    interval: string
    timeout: string
    retries: number
    start_period: string
    start_interval: string
  }
  platform?: string
  restart?: string
  read_only?: boolean
  user?: string
  profiles?: string[]
}

type ComposeServiceVolume = {
  type: 'volume' | 'bind' | 'tmpfs' | 'image' | 'npipe' | 'cluster'
  source?: string
  target: string
  read_only?: boolean
  bind?: {
    propagation?: string
    create_host_path?: boolean
    selinux?: 'z' | 'Z'
  }
  volume: {
    nocopy?: boolean
    subpath?: string
  }
  tmpfs?: {
    size?: number
    mode?: number
  }
  image?: {
    subpath?: string
  }
  consistency: string
}

type ComposePort = {
  name?: string
  mode: 'ingress' | 'host'
  target: number
  published: string
  host_ip?: string
  protocol: 'tcp' | 'udp'
  app_protocol?: string
}

type ComposeVolume = {
  driver?: string
  driver_opts?: Record<string, string>
  name: string
  external?: boolean
  labels?: Record<string, string>
}

type ComposeConfig = {
  version?: string
  name?: string
  networks: Record<string, ComposeNetwork>
  services: Record<string, ComposeService>
  volumes?: Record<string, ComposeVolume>
}
