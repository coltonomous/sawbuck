#!/bin/sh
# Create CloudWatch metric filters + alarms for Sawbuck observability.
#
# Idempotent — re-run safely to update thresholds. Requires:
#   - aws CLI configured with logs:* and cloudwatch:* permissions
#   - SNS_ALERT_TOPIC_ARN env var pointing at an SNS topic with a subscriber
#     (email, SMS, Slack webhook via Chatbot, etc.)
#   - Log groups already created by the awslogs driver (run after first deploy)
#
# Usage:
#   export SNS_ALERT_TOPIC_ARN=arn:aws:sns:us-west-2:123456789012:sawbuck-alerts
#   export AWS_REGION=us-west-2
#   ./scripts/setup-cloudwatch-alarms.sh
set -eu

: "${AWS_REGION:=us-east-1}"
: "${SNS_ALERT_TOPIC_ARN:?set SNS_ALERT_TOPIC_ARN (subscribe your email/Slack to the topic first)}"

NS=Sawbuck
APP_LOG=/sawbuck/app
BACKUP_LOG=/sawbuck/backup

echo "==> Creating metric filters in $AWS_REGION"

# pino level 50 = error. Matches JSON log lines emitted by the app.
aws logs put-metric-filter --region "$AWS_REGION" \
  --log-group-name "$APP_LOG" \
  --filter-name sawbuck-app-errors \
  --filter-pattern '{ $.level = 50 }' \
  --metric-transformations \
    "metricName=AppErrors,metricNamespace=$NS,metricValue=1,defaultValue=0"

# pino level 60 = fatal. Emitted by the uncaughtException handler.
aws logs put-metric-filter --region "$AWS_REGION" \
  --log-group-name "$APP_LOG" \
  --filter-name sawbuck-app-fatal \
  --filter-pattern '{ $.level = 60 }' \
  --metric-transformations \
    "metricName=AppFatal,metricNamespace=$NS,metricValue=1,defaultValue=0"

# Backup sidecar logs plain text; match the literal "failed" substring.
aws logs put-metric-filter --region "$AWS_REGION" \
  --log-group-name "$BACKUP_LOG" \
  --filter-name sawbuck-backup-failed \
  --filter-pattern '"failed"' \
  --metric-transformations \
    "metricName=BackupFailures,metricNamespace=$NS,metricValue=1,defaultValue=0"

echo "==> Creating alarms"

# >3 errors in 5 min. Tune up if this gets noisy at higher traffic.
aws cloudwatch put-metric-alarm --region "$AWS_REGION" \
  --alarm-name sawbuck-app-errors \
  --alarm-description "Sawbuck: elevated app error rate" \
  --namespace "$NS" --metric-name AppErrors \
  --statistic Sum --period 300 --evaluation-periods 1 \
  --threshold 3 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$SNS_ALERT_TOPIC_ARN"

# Any fatal = process crashed. Page immediately.
aws cloudwatch put-metric-alarm --region "$AWS_REGION" \
  --alarm-name sawbuck-app-fatal \
  --alarm-description "Sawbuck: uncaught exception / fatal log" \
  --namespace "$NS" --metric-name AppFatal \
  --statistic Sum --period 60 --evaluation-periods 1 \
  --threshold 0 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$SNS_ALERT_TOPIC_ARN"

# Daily backup check — if the sidecar logged any failure in the last 24h.
aws cloudwatch put-metric-alarm --region "$AWS_REGION" \
  --alarm-name sawbuck-backup-failures \
  --alarm-description "Sawbuck: DB backup sidecar failed" \
  --namespace "$NS" --metric-name BackupFailures \
  --statistic Sum --period 86400 --evaluation-periods 1 \
  --threshold 0 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$SNS_ALERT_TOPIC_ARN"

# Instance-down heuristic: no app log events received for 10 min.
aws cloudwatch put-metric-alarm --region "$AWS_REGION" \
  --alarm-name sawbuck-app-silent \
  --alarm-description "Sawbuck: no app log events for 10min (instance down?)" \
  --namespace AWS/Logs --metric-name IncomingLogEvents \
  --dimensions "Name=LogGroupName,Value=$APP_LOG" \
  --statistic Sum --period 600 --evaluation-periods 1 \
  --threshold 1 --comparison-operator LessThanThreshold \
  --treat-missing-data breaching \
  --alarm-actions "$SNS_ALERT_TOPIC_ARN"

echo "==> Done. Verify alarms at:"
echo "  https://$AWS_REGION.console.aws.amazon.com/cloudwatch/home?region=$AWS_REGION#alarmsV2:"
