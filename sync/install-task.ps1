<#
.SYNOPSIS
Registra (ou remove) a rodada diaria da agenda no Agendador de Tarefas do Windows.

.DESCRIPTION
Roda `node sync/daily.js` todo dia no horario escolhido (padrao 06:00). Se o PC estava
desligado ou dormindo nesse horario, roda assim que possivel. So roda com o seu usuario
logado, que e onde esta o login do Claude. Roda sem janela (conhost --headless); o
resultado fica em sync/logs/AAAA-MM-DD.log e em sync-data/rodada.json.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File sync\install-task.ps1 -WhatIf
Mostra o que seria registrado, sem registrar.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File sync\install-task.ps1
Registra a tarefa (ou atualiza, se ja existir).

.EXAMPLE
powershell -ExecutionPolicy Bypass -File sync\install-task.ps1 -Remover
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Hora = "06:00",
  [switch]$Remover
)

$ErrorActionPreference = "Stop"
$nome = "Agenda - rodada diaria"
$repo = Split-Path -Parent $PSScriptRoot

if ($Remover) {
  if ($PSCmdlet.ShouldProcess($nome, "Remover a tarefa agendada")) {
    Unregister-ScheduledTask -TaskName $nome -Confirm:$false
    Write-Host "Tarefa '$nome' removida."
  }
  return
}

# O worktree some depois do merge e a tarefa ficaria apontando para o nada.
if ($repo -match '\\\.claude\\worktrees\\') {
  throw "Instale a partir do checkout principal, nao de um worktree: $repo"
}

$node = (Get-Command node).Source
$daily = Join-Path $repo "sync\daily.js"
$conhost = Join-Path $env:WINDIR "System32\conhost.exe"
$argumentos = "--headless `"$node`" `"$daily`""

$acao = New-ScheduledTaskAction -Execute $conhost -Argument $argumentos -WorkingDirectory $repo
$gatilho = New-ScheduledTaskTrigger -Daily -At $Hora
# Limite de 3h: abaixo das 6h em que o daily.js considera a trava abandonada.
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3)
$usuario = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Write-Host "Tarefa:  $nome"
Write-Host "Horario: todo dia as $Hora; se o PC estava desligado, roda assim que possivel"
Write-Host "Usuario: $($usuario.UserId) (so com ele logado)"
Write-Host "Comando: $conhost $argumentos"
Write-Host "Pasta:   $repo"
Write-Host "Log:     $(Join-Path $repo 'sync\logs')\AAAA-MM-DD.log"

if ($PSCmdlet.ShouldProcess($nome, "Registrar a tarefa agendada")) {
  Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $config -Principal $usuario -Description "Resume as sessoes do Claude no Obsidian e sugere tarefas na agenda." -Force | Out-Null
  Write-Host "Tarefa registrada. Para rodar agora: Start-ScheduledTask -TaskName '$nome'"
}
