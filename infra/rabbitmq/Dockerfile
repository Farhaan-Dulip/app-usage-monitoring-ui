# Self-run RabbitMQ for the AWS POC. Same major version as docker-compose.yml.
# TLS material and passwords arrive as environment variables from Secrets
# Manager; entrypoint.sh writes them to disk and reconciles users on each boot.
FROM rabbitmq:4-management
COPY 20-poc.conf /etc/rabbitmq/conf.d/20-poc.conf
COPY entrypoint.sh /usr/local/bin/poc-entrypoint.sh
RUN chmod 0755 /usr/local/bin/poc-entrypoint.sh
# Data lives on EFS; a fixed node name keeps it readable across Fargate tasks,
# whose hostnames change on every start.
ENV RABBITMQ_NODENAME=rabbit@localhost \
    RABBITMQ_USE_LONGNAME=false
EXPOSE 5671 5672 15672
ENTRYPOINT ["/usr/local/bin/poc-entrypoint.sh"]
