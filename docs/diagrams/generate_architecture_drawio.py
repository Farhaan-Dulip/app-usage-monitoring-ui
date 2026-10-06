"""Generates docs/architecture.drawio (three pages, AWS icon set).

    python docs/diagrams/generate_architecture_drawio.py

Open the result in draw.io (desktop, app.diagrams.net or the VS Code extension)
to view, adjust and export it.
"""
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parents[1] / "architecture.drawio"

ORANGE, PURPLE, RED, PINK, GREEN, DB, DARK = "#ED7100", "#8C4FFF", "#DD344C", "#E7157B", "#7AA116", "#C925D1", "#232F3D"


def res(icon, fill):
    return ("sketch=0;outlineConnect=0;fontColor=#232F3E;fillColor=%s;strokeColor=#ffffff;dashed=0;"
            "verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;"
            "aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.%s;") % (fill, icon)


def shp(shape, fill):
    return ("sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=%s;strokeColor=none;"
            "dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;"
            "fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.%s;") % (fill, shape)


def grp(icon, stroke, fill, font):
    return ("points=[];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=13;fontStyle=1;"
            "container=0;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;"
            "grIcon=mxgraph.aws4.%s;strokeColor=%s;fillColor=%s;verticalAlign=top;align=left;"
            "spacingLeft=30;fontColor=%s;dashed=0;") % (icon, stroke, fill, font)


BADGE = ("ellipse;whiteSpace=wrap;html=1;fillColor=#232F3E;strokeColor=none;fontColor=#FFFFFF;"
         "fontStyle=1;fontSize=13;aspect=fixed;")
EXT = ("rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#232F3E;fontColor=#232F3E;"
       "fontSize=12;")
CLUSTER = ("rounded=1;arcSize=3;whiteSpace=wrap;html=1;dashed=1;fillColor=none;strokeColor=#ED7100;"
           "fontColor=#ED7100;fontSize=12;fontStyle=1;verticalAlign=top;align=left;spacingLeft=10;spacingTop=4;")
EDGE = ("edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=open;endFill=0;strokeColor=#232F3E;"
        "strokeWidth=1.5;fontSize=11;fontColor=#232F3E;labelBackgroundColor=#FFFFFF;")
DASH = EDGE + "dashed=1;strokeColor=#879196;"
NOTE = ("text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;fontSize=12;fontColor=#232F3E;"
        "strokeColor=#D5DBDB;fillColor=#FAFAFA;spacing=10;rounded=1;arcSize=2;")


def lines(*parts):
    return "<br>".join(parts)


class Page:
    def __init__(self, name, width, height):
        self.name, self.width, self.height = name, width, height
        self.cells, self.count = [], 1

    def _id(self):
        self.count += 1
        return "c%d" % self.count

    def vertex(self, label, style, x, y, w, h):
        cell_id = self._id()
        self.cells.append(
            '<mxCell id="%s" value="%s" style="%s" vertex="1" parent="1">'
            '<mxGeometry x="%d" y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
            % (cell_id, escape(label, {'"': "&quot;"}), style, x, y, w, h))
        return cell_id

    def edge(self, src, dst, style=EDGE, label="", both=False, exit=None, entry=None):
        cell_id = self._id()
        st = style + ("startArrow=open;startFill=0;" if both else "")
        if exit:
            st += "exitX=%s;exitY=%s;exitDx=0;exitDy=0;" % exit
        if entry:
            st += "entryX=%s;entryY=%s;entryDx=0;entryDy=0;" % entry
        self.cells.append(
            '<mxCell id="%s" value="%s" style="%s" edge="1" parent="1" source="%s" target="%s">'
            '<mxGeometry relative="1" as="geometry"/></mxCell>'
            % (cell_id, escape(label, {'"': "&quot;"}), st, src, dst))
        return cell_id

    def badge(self, number, x, y):
        return self.vertex(str(number), BADGE, x, y, 30, 30)

    def xml(self):
        return ('<diagram id="%s" name="%s"><mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" '
                'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="%d" pageHeight="%d" '
                'math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>%s</root>'
                '</mxGraphModel></diagram>'
                % (self.name.split(" (")[0].lower().replace(" ", "-"), escape(self.name),
                   self.width, self.height, "".join(self.cells)))


def ec2_page():
    p = Page("EC2 Docker deployment (UsagePocEc2)", 1450, 1110)
    p.vertex("AWS Cloud (us-east-1)", grp("group_aws_cloud_alt", "#232F3E", "none", "#232F3E"), 170, 40, 1240, 740)
    p.vertex("VPC (one AZ, no NAT gateway)", grp("group_vpc2", PURPLE, "none", PURPLE), 400, 90, 660, 660)
    p.vertex("Public subnet", grp("group_public_subnet", GREEN, "#F2F6E8", "#248814"), 420, 130, 620, 600)
    p.vertex(lines("Security group: :80 from CloudFront prefix list only, :5671 from anywhere, no SSH"),
             "text;html=1;fontSize=11;fontColor=#DD344C;align=left;", 440, 160, 560, 20)
    p.vertex("Amazon EC2 t3.small (Amazon Linux 2023, Docker Compose)",
             grp("group_ec2_instance_contents", ORANGE, "none", ORANGE), 580, 200, 440, 510)

    web = p.vertex("<b>Admin browser</b>", shp("client", DARK), 50, 230, 60, 60)
    laptops = p.vertex(lines("<b>Tracker laptops</b>", "Windows, every 10 s"), shp("client", DARK), 50, 470, 60, 60)
    cf = p.vertex(lines("<b>Amazon CloudFront</b>", "HTTPS, IP check,", "blocks /api/mcp"), res("cloudfront", PURPLE), 250, 230, 64, 64)
    eip = p.vertex(lines("<b>Elastic IP</b>", "fixed public IP"), shp("elastic_ip_address", ORANGE), 470, 470, 64, 64)
    portal = p.vertex(lines("<b>Portal</b>", "React UI + Express API", "checks X-Origin-Verify"), res("container_1", ORANGE), 650, 250, 64, 64)
    agent = p.vertex(lines("<b>AI agent</b>", "OpenAI tool loop"), res("container_1", ORANGE), 890, 250, 64, 64)
    rabbit = p.vertex(lines("<b>RabbitMQ</b>", "private-CA TLS :5671"), res("container_1", ORANGE), 650, 470, 64, 64)
    worker = p.vertex(lines("<b>Telemetry worker</b>", "queue to MongoDB"), res("container_1", ORANGE), 890, 470, 64, 64)
    ebs = p.vertex(lines("<b>Amazon EBS</b>", "gp3 16 GB, broker volume"), res("elastic_block_store", GREEN), 650, 610, 50, 50)
    ecr = p.vertex(lines("<b>Amazon ECR</b>", "container images"), res("ecr", ORANGE), 1220, 170, 64, 64)
    secrets = p.vertex(lines("<b>AWS Secrets Manager</b>", "Atlas URI, OpenAI key,", "broker passwords, TLS"),
                       res("secrets_manager", RED), 1220, 400, 64, 64)
    logs = p.vertex(lines("<b>Amazon CloudWatch</b>", "container logs"), res("cloudwatch_2", PINK), 1220, 620, 64, 64)
    atlas = p.vertex(lines("<b>MongoDB Atlas (M0)</b>", "allows the Elastic IP only"), EXT, 700, 830, 180, 52)
    openai = p.vertex(lines("<b>OpenAI API</b>", "LLM"), EXT, 960, 830, 150, 52)

    p.edge(web, cf)
    p.edge(cf, portal, label="HTTP :80 + secret header")
    p.edge(portal, agent, both=True, label="Compose network + token")
    p.edge(laptops, eip, label="AMQPS")
    p.edge(eip, rabbit)
    p.edge(rabbit, worker)
    p.edge(rabbit, ebs, DASH)
    p.edge(portal, atlas, DASH, exit=("0", "0.75"), entry=("0", "0.5"))
    p.edge(worker, atlas, DASH, exit=("0.5", "1"), entry=("0.75", "0"))
    p.edge(agent, openai, DASH, exit=("1", "0.75"), entry=("0.75", "0"))
    p.edge(ecr, agent, DASH, label="pull at boot")
    p.edge(secrets, worker, DASH, label="read at boot")
    p.edge(worker, logs, DASH, exit=("1", "1"), label="awslogs")

    for number, x, y in [(1, 140, 210), (2, 440, 220), (3, 790, 225), (4, 140, 450), (5, 790, 445),
                         (6, 610, 800), (7, 1140, 380), (8, 1140, 150)]:
        p.badge(number, x, y)
    p.vertex(lines(
        "<b>Request and data flows</b>",
        "<b>1</b> Admin opens the portal over HTTPS; a CloudFront Function applies the IP allow-list and blocks /api/mcp/*.",
        "<b>2</b> CloudFront calls the instance on port 80 with a secret X-Origin-Verify header; the security group only admits CloudFront's addresses.",
        "<b>3</b> Portal and AI agent call each other on the Docker Compose network with a shared service token.",
        "<b>4</b> Tracker laptops publish telemetry every 10 s over TLS straight to RabbitMQ on the Elastic IP.",
        "<b>5</b> The telemetry worker consumes the queue and writes to MongoDB Atlas; raw telemetry expires after 30 days.",
        "<b>6</b> Outbound calls (Atlas, OpenAI) leave from the Elastic IP, which is on the Atlas allow-list.",
        "<b>7</b> At boot, start.sh reads secrets from Secrets Manager and passes them to the containers as environment variables.",
        "<b>8</b> cdk deploy builds the images, pushes them to ECR and replaces the instance; the Elastic IP moves to the new one."),
        NOTE, 170, 910, 1240, 190)
    return p


def docker_page():
    p = Page("ECS Docker deployment (UsagePoc, shut down)", 1500, 1120)
    p.vertex("AWS Cloud (us-east-1)", grp("group_aws_cloud_alt", "#232F3E", "none", "#232F3E"), 170, 40, 1290, 820)
    p.vertex("VPC", grp("group_vpc2", PURPLE, "none", PURPLE), 420, 90, 760, 740)
    p.vertex("Public subnets", grp("group_public_subnet", GREEN, "#F2F6E8", "#248814"), 440, 130, 190, 680)
    p.vertex("Private subnets", grp("group_private_subnet", "#00A4A6", "#E6F6F7", "#147EBA"), 650, 130, 510, 680)
    p.vertex("Amazon ECS cluster (AWS Fargate)", CLUSTER, 800, 160, 340, 470)

    web = p.vertex("<b>Admin browser</b>", shp("client", DARK), 50, 170, 60, 60)
    laptops = p.vertex(lines("<b>Tracker laptops</b>", "Windows, at logon"), shp("client", DARK), 50, 470, 60, 60)
    cf = p.vertex(lines("<b>Amazon CloudFront</b>", "HTTPS + IP check"), res("cloudfront", PURPLE), 250, 170, 64, 64)
    nlb = p.vertex(lines("<b>Network Load Balancer</b>", "TLS :5671"), shp("network_load_balancer", PURPLE), 496, 470, 64, 64)
    nat = p.vertex(lines("<b>NAT gateway</b>", "fixed outbound IP"), shp("nat_gateway", PURPLE), 496, 690, 64, 64)
    alb = p.vertex(lines("<b>Application Load Balancer</b>", "internal, blocks /api/mcp"),
                   shp("application_load_balancer", PURPLE), 680, 170, 64, 64)
    portal = p.vertex(lines("<b>Portal</b>", "React UI + Express API"), res("container_1", ORANGE), 840, 200, 64, 64)
    agent = p.vertex(lines("<b>AI agent</b>", "OpenAI tool loop"), res("container_1", ORANGE), 1030, 200, 64, 64)
    rabbit = p.vertex(lines("<b>RabbitMQ</b>", "private-CA TLS"), res("container_1", ORANGE), 840, 470, 64, 64)
    worker = p.vertex(lines("<b>Telemetry worker</b>", "queue to MongoDB"), res("container_1", ORANGE), 1030, 470, 64, 64)
    efs = p.vertex(lines("<b>Amazon EFS</b>", "broker data"), res("elastic_file_system", GREEN), 840, 700, 64, 64)
    ecr = p.vertex(lines("<b>Amazon ECR</b>", "container images"), res("ecr", ORANGE), 1290, 170, 64, 64)
    secrets = p.vertex(lines("<b>AWS Secrets Manager</b>", "Atlas URI, OpenAI key,", "broker passwords, TLS"),
                       res("secrets_manager", RED), 1290, 400, 64, 64)
    logs = p.vertex(lines("<b>Amazon CloudWatch</b>", "logs + alarms"), res("cloudwatch_2", PINK), 1290, 640, 64, 64)
    atlas = p.vertex(lines("<b>MongoDB Atlas (M0)</b>", "allows the NAT IP only"), EXT, 430, 900, 170, 52)
    openai = p.vertex(lines("<b>OpenAI API</b>", "LLM"), EXT, 650, 900, 150, 52)

    p.edge(web, cf)
    p.edge(cf, alb, label="VPC origin")
    p.edge(alb, portal)
    p.edge(portal, agent, both=True, label="Service Connect")
    p.edge(laptops, nlb, label="AMQPS")
    p.edge(nlb, rabbit)
    p.edge(rabbit, worker)
    p.edge(rabbit, efs)
    p.edge(portal, nat, DASH, exit=("0.25", "1"), entry=("1", "0.25"))
    p.edge(worker, nat, DASH, exit=("0.5", "1"), entry=("1", "0.75"))
    p.edge(agent, nat, DASH, exit=("1", "0.5"), entry=("0.5", "0"))
    p.edge(nat, atlas, entry=("0.5", "0"))
    p.edge(nat, openai, exit=("1", "1"), entry=("0.5", "0"))
    p.edge(ecr, agent, DASH, label="pull images")
    p.edge(secrets, worker, DASH, label="inject at start")
    p.edge(worker, logs, DASH, exit=("1", "1"), label="logs")

    for number, x, y in [(1, 140, 150), (2, 470, 150), (3, 960, 175), (4, 590, 760), (5, 140, 450),
                         (6, 960, 450), (7, 410, 860), (8, 1210, 380), (9, 1210, 150)]:
        p.badge(number, x, y)
    p.vertex(lines(
        "<b>Request and data flows</b>",
        "<b>1</b> Admin opens the portal over HTTPS; a CloudFront Function applies the IP allow-list.",
        "<b>2</b> CloudFront forwards privately (VPC origin) to the internal ALB, which routes to the portal and blocks /api/mcp/*.",
        "<b>3</b> Portal and AI agent call each other over Service Connect with a shared service token.",
        "<b>4</b> All outbound traffic (Atlas, OpenAI) leaves through the NAT gateway's fixed IP.",
        "<b>5</b> Tracker laptops publish telemetry every 10 s over TLS through the NLB to RabbitMQ.",
        "<b>6</b> The telemetry worker consumes the queue; RabbitMQ data on EFS survives restarts.",
        "<b>7</b> Portal and worker read and write MongoDB Atlas; raw telemetry expires after 30 days.",
        "<b>8</b> ECS injects secrets from Secrets Manager at task start; logs go to CloudWatch.",
        "<b>9</b> cdk deploy builds the images, pushes them to ECR and rolls out new tasks."),
        NOTE, 850, 880, 610, 220)
    return p


def serverless_page():
    p = Page("Serverless deployment (UsagePocServerless)", 1250, 1010)
    p.vertex("AWS Cloud (us-east-1)", grp("group_aws_cloud_alt", "#232F3E", "none", "#232F3E"), 170, 40, 1030, 620)
    web = p.vertex("<b>Admin browser</b>", shp("client", DARK), 50, 160, 60, 60)
    laptops = p.vertex(lines("<b>Tracker laptops</b>", "HTTPS transport"), shp("client", DARK), 50, 430, 60, 60)
    amplify = p.vertex(lines("<b>AWS Amplify Hosting</b>", "UI + password, proxies /api"), res("amplify", RED), 260, 160, 64, 64)
    portal = p.vertex(lines("<b>Portal API</b>", "AWS Lambda (Express)"), res("lambda", ORANGE), 520, 160, 64, 64)
    agent = p.vertex(lines("<b>AI agent</b>", "AWS Lambda"), res("lambda", ORANGE), 780, 160, 64, 64)
    ingest = p.vertex(lines("<b>Telemetry ingest</b>", "AWS Lambda + token"), res("lambda", ORANGE), 520, 430, 64, 64)
    table = p.vertex(lines("<b>Amazon DynamoDB</b>", "on-demand, 30-day TTL"), res("dynamodb", DB), 780, 430, 64, 64)
    params = p.vertex(lines("<b>Systems Manager</b>", "Parameter Store (secrets)"), res("systems_manager", PINK), 1040, 160, 64, 64)
    logs = p.vertex(lines("<b>Amazon CloudWatch</b>", "logs"), res("cloudwatch_2", PINK), 1040, 430, 64, 64)
    openai = p.vertex(lines("<b>OpenAI API</b>", "LLM"), EXT, 737, 700, 150, 52)

    p.edge(web, amplify)
    p.edge(amplify, portal, label="/api/* proxy")
    p.edge(portal, agent, both=True, label="function URLs + token")
    p.edge(agent, openai, exit=("0.5", "1"), entry=("0.5", "0"))
    p.edge(portal, table, exit=("0.5", "1"), entry=("0", "0.25"))
    p.edge(laptops, ingest, label="HTTPS POST")
    p.edge(ingest, table)
    p.edge(agent, params, DASH, label="secrets at cold start")
    p.edge(table, logs, DASH, label="logs")
    for number, x, y in [(1, 160, 140), (2, 420, 140), (3, 680, 140), (4, 860, 600), (5, 600, 300),
                         (6, 160, 410), (7, 680, 410), (8, 940, 140)]:
        p.badge(number, x, y)
    p.vertex(lines(
        "<b>Request and data flows</b>",
        "<b>1</b> Admin opens the Amplify-hosted portal (shared username and password).",
        "<b>2</b> Amplify serves the UI and proxies /api/* to the portal Lambda function URL.",
        "<b>3</b> Portal and AI agent call each other through function URLs with a shared service token.",
        "<b>4</b> The AI agent calls OpenAI.",
        "<b>5</b> The portal reads and writes DynamoDB (same server.js, DynamoDB adapter).",
        "<b>6</b> Tracker laptops POST telemetry over HTTPS with a bearer token.",
        "<b>7</b> The ingest function stores each sample once in DynamoDB.",
        "<b>8</b> Functions read secrets from SSM Parameter Store at cold start; nothing bills by the hour."),
        NOTE, 170, 780, 1030, 200)
    return p


if __name__ == "__main__":
    pages = [ec2_page(), serverless_page(), docker_page()]
    OUT.write_text('<mxfile host="app.diagrams.net" agent="usage-poc">%s</mxfile>\n'
                   % "".join(page.xml() for page in pages), encoding="utf-8")
    print("wrote", OUT)
