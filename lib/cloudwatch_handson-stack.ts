import * as cdk from "aws-cdk-lib"
import {
  aws_ec2 as ec2,
  aws_elasticloadbalancingv2 as elb,
  aws_elasticloadbalancingv2_targets as targets,
  aws_iam as iam,
} from "aws-cdk-lib"

export class CloudwatchHandsonStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const vpc = new ec2.Vpc(this, "VPC", {
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    })

    const securityGroupEC2 = new ec2.SecurityGroup(this, "SecurityGroupEC2", {
      vpc,
      description: "For ec2 instance",
      allowAllOutbound: true,
    })

    const role = new iam.Role(this, "PublicInstanceRole", { assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com") })
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"))

    const userData = ec2.UserData.forLinux({ shebang: "#!/bin/bash" })
    userData.addCommands(
      "yum update -y",
      "yum install -y httpd",
      "systemctl start httpd.service",
      "systemctl enable httpd.service",
      "curl http://169.254.169.254/latest/meta-data/ > /var/www/html/index.html"
    )

    const instance = new ec2.Instance(this, "PublicInstance", {
      vpc,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      securityGroup: securityGroupEC2,
      role,
      userData,
    })

    const securityGroupALB = new ec2.SecurityGroup(this, "SecurityGroupALB", {
      vpc,
      description: "For public ALB",
      allowAllOutbound: true,
    })
    securityGroupALB.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Allow public HTTP access")

    const alb = new elb.ApplicationLoadBalancer(this, "ALB", {
      vpc,
      internetFacing: true,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }),
      securityGroup: securityGroupALB,
    })

    const listener = alb.addListener("Listener", { port: 80 })
    listener.addTargets("Target", {
      port: 80,
      targets: [new targets.InstanceTarget(instance)],
    })

    securityGroupEC2.addIngressRule(
      ec2.Peer.securityGroupId(securityGroupALB.securityGroupId),
      ec2.Port.tcp(80),
      "Allow HTTP access from ALB"
    )

    new cdk.CfnOutput(this, "ALB DNS name", { value: alb.loadBalancerDnsName })
  }
}
