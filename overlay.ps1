param([string]$ServerUrl = "http://127.0.0.1:8787")

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Net.Http, System.Windows.Forms, System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OverlayWindow {
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
}
"@

$script:serverUrl = $ServerUrl.TrimEnd("/")
$script:startedServer = $null
$script:pendingProposal = $null
$script:blocks = @()
$script:mode = "auto"
$script:refreshing = $false
$script:statusAfterRefresh = $null
$script:requests = New-Object System.Collections.ArrayList
$script:client = New-Object System.Net.Http.HttpClient
$script:client.Timeout = [TimeSpan]::FromSeconds(190)
$script:culture = [Globalization.CultureInfo]::GetCultureInfo("pt-BR")
$script:goalColors = @("#246eaa", "#ba4c76", "#21816a", "#bd7b12", "#7752a6", "#b94737", "#327e85")
$script:storageRoot = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) "DailyCalendarIA"
$script:notesPath = Join-Path $script:storageRoot "notes.txt"
$script:timerPath = Join-Path $script:storageRoot "pomodoro.json"
$script:settingsPath = Join-Path $script:storageRoot "overlay-settings.json"
$script:transparencyLevel = 0
$script:textTone = "black"
$script:notesLoading = $true
$script:timerPhase = "focus"
$script:timerRemaining = 25 * 60
$script:timerRunning = $false
$script:timerEndAt = $null
$script:focusCount = 0
$script:tab = "today"

function Brush([string]$hex) {
  [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.ColorConverter]::ConvertFromString($hex))
}

function LocalText([string]$value) {
  [System.Net.WebUtility]::HtmlDecode($value)
}

function Invoke-AgendaRequest {
  param([string]$Path)
  Invoke-RestMethod -Uri ($script:serverUrl + $Path) -TimeoutSec 5 -ErrorAction Stop
}

function Ensure-AgendaServer {
  try {
    $script:aiStatus = Invoke-AgendaRequest "/api/status"
    return $true
  } catch {}
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    [System.Windows.MessageBox]::Show("Node.js nao foi encontrado. Inicie a agenda primeiro.", "Minha agenda") | Out-Null
    return $false
  }
  $root = Split-Path -Parent $PSCommandPath
  $script:startedServer = Start-Process -FilePath $node.Source -ArgumentList @("server.js") -WorkingDirectory $root -WindowStyle Hidden -PassThru
  for ($attempt = 0; $attempt -lt 12; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $script:aiStatus = Invoke-AgendaRequest "/api/status"
      return $true
    } catch {}
  }
  [System.Windows.MessageBox]::Show("Nao foi possivel iniciar o servidor da agenda.", "Minha agenda") | Out-Null
  return $false
}

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Minha agenda" Width="318" Height="404" MinWidth="270" MinHeight="310"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        ResizeMode="NoResize" ShowInTaskbar="True" Topmost="True"
        FontFamily="Segoe UI" FontWeight="Bold" SnapsToDevicePixels="True">
  <Window.Resources>
    <SolidColorBrush x:Key="TextBrush" Color="#FF000000"/>
    <SolidColorBrush x:Key="IconHoverBrush" Color="#62FFFFFF"/>
    <SolidColorBrush x:Key="IconPressedBrush" Color="#A7FFFFFF"/>
    <SolidColorBrush x:Key="ActionBrush" Color="#FFE0F0F0"/>
    <SolidColorBrush x:Key="ActionHoverBrush" Color="#FFCEE7E7"/>
    <SolidColorBrush x:Key="ActionPressedBrush" Color="#FFB8DADA"/>
    <Style x:Key="IconButton" TargetType="Button">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Foreground" Value="{DynamicResource TextBrush}"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="FontSize" Value="15"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Surface" Background="{TemplateBinding Background}" CornerRadius="8">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Surface" Property="Background" Value="{DynamicResource IconHoverBrush}"/></Trigger>
              <Trigger Property="IsPressed" Value="True"><Setter TargetName="Surface" Property="Background" Value="{DynamicResource IconPressedBrush}"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="ModeButton" TargetType="Button" BasedOn="{StaticResource IconButton}">
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="FontWeight" Value="Bold"/>
      <Setter Property="Foreground" Value="{DynamicResource TextBrush}"/>
    </Style>
    <Style x:Key="ActionButton" TargetType="Button">
      <Setter Property="Background" Value="{DynamicResource ActionBrush}"/>
      <Setter Property="Foreground" Value="{DynamicResource TextBrush}"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="FontWeight" Value="Bold"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Surface" Background="{TemplateBinding Background}" CornerRadius="8">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Surface" Property="Background" Value="{DynamicResource ActionHoverBrush}"/></Trigger>
              <Trigger Property="IsPressed" Value="True"><Setter TargetName="Surface" Property="Background" Value="{DynamicResource ActionPressedBrush}"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="ResizeEdge" TargetType="Thumb">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Focusable" Value="False"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Thumb">
            <Border x:Name="Edge" Background="{TemplateBinding Background}"/>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Edge" Property="Background" Value="#55FFFFFF"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>
  <Grid>
  <Border x:Name="OuterShell" Margin="6" CornerRadius="13" BorderThickness="1" BorderBrush="#FFFFFFFF" Background="#FFFFFFFF">
    <Border.Effect>
      <DropShadowEffect BlurRadius="16" ShadowDepth="4" Opacity="0.18" Color="#171D24"/>
    </Border.Effect>
    <Grid>
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="*"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>
      <Grid x:Name="Header" Grid.Row="0" Margin="13,9,9,0">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="25"/>
          <ColumnDefinition Width="25"/>
          <ColumnDefinition Width="25"/>
          <ColumnDefinition Width="25"/>
          <ColumnDefinition Width="25"/>
        </Grid.ColumnDefinitions>
        <StackPanel x:Name="DragArea" Grid.Column="0" Cursor="SizeAll">
          <TextBlock Text="Minha agenda" FontSize="14" FontWeight="Bold" Foreground="{DynamicResource TextBrush}" TextTrimming="CharacterEllipsis"/>
          <TextBlock x:Name="DateText" FontSize="10" Foreground="{DynamicResource TextBrush}" Margin="1,0,0,0" TextTrimming="CharacterEllipsis"/>
        </StackPanel>
        <Button x:Name="OpacityButton" Grid.Column="1" Style="{StaticResource IconButton}" Content="&#x25D0;" Width="24" Height="24" ToolTip="Alterar transparencia"/>
        <Button x:Name="TextColorButton" Grid.Column="2" Style="{StaticResource IconButton}" Content="A" FontWeight="Bold" Width="24" Height="24" ToolTip="Alternar cor do texto"/>
        <Button x:Name="OpenCalendarButton" Grid.Column="3" Style="{StaticResource IconButton}" Content="&#x2197;" Width="24" Height="24" ToolTip="Abrir calendario completo"/>
        <Button x:Name="MinimizeButton" Grid.Column="4" Style="{StaticResource IconButton}" Content="&#x2212;" Width="24" Height="24" ToolTip="Minimizar"/>
        <Button x:Name="CloseButton" Grid.Column="5" Style="{StaticResource IconButton}" Content="&#x00D7;" Width="24" Height="24" ToolTip="Fechar"/>
      </Grid>
      <Border x:Name="TimerSurface" Grid.Row="1" Margin="13,8,13,6" Padding="8,5" Background="#FFFFFFFF" BorderBrush="#FFFFFFFF" BorderThickness="1" CornerRadius="8">
        <Grid>
          <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="60"/><ColumnDefinition Width="26"/></Grid.ColumnDefinitions>
          <StackPanel>
            <TextBlock x:Name="TimerPhaseLabel" FontSize="10" FontWeight="Bold" Foreground="{DynamicResource TextBrush}"/>
            <TextBlock x:Name="TimerClock" FontSize="21" FontWeight="Bold" Foreground="{DynamicResource TextBrush}" Margin="0,-2,0,0"/>
          </StackPanel>
          <Button x:Name="TimerToggleButton" Grid.Column="1" Style="{StaticResource ActionButton}" Content="Iniciar" Width="57" Height="26" VerticalAlignment="Center" ToolTip="Iniciar ou pausar o Pomodoro"/>
          <Button x:Name="TimerResetButton" Grid.Column="2" Style="{StaticResource IconButton}" Content="&#x21BA;" Width="25" Height="25" VerticalAlignment="Center" ToolTip="Reiniciar fase atual"/>
        </Grid>
      </Border>
      <Grid x:Name="Tabs" Grid.Row="2" Height="26" Margin="13,0,13,6">
        <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="*"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
        <Button x:Name="TodayTab" Grid.Column="0" Style="{StaticResource ModeButton}" Content="Hoje"/>
        <Button x:Name="NotesTab" Grid.Column="1" Style="{StaticResource ModeButton}" Content="Notas"/>
        <Button x:Name="AssistantTab" Grid.Column="2" Style="{StaticResource ModeButton}" Content="IA"/>
      </Grid>
      <Grid Grid.Row="3" Margin="11,0,11,0">
        <Grid x:Name="TodayPane">
          <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
          <TextBlock x:Name="NextText" Margin="5,0,5,5" FontSize="10" Foreground="{DynamicResource TextBrush}" TextTrimming="CharacterEllipsis"/>
          <ScrollViewer x:Name="TaskScroll" Grid.Row="1" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled">
            <StackPanel x:Name="TaskList" Margin="1,0,6,0"/>
          </ScrollViewer>
        </Grid>
        <Border x:Name="NotesPane" Visibility="Collapsed" Background="#FFFFFFFF" BorderBrush="#FFFFFFFF" BorderThickness="1" CornerRadius="8" Margin="2,0,2,2">
          <TextBox x:Name="NotesBox" Background="Transparent" BorderThickness="0" FontSize="12" Foreground="{DynamicResource TextBrush}"
                   Padding="8,6" AcceptsReturn="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto"
                   ToolTip="Notas pessoais salvas automaticamente neste computador"/>
        </Border>
        <Grid x:Name="ReviewPane" Visibility="Collapsed" Margin="6,0,6,0">
          <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
          <StackPanel Margin="1,0,1,14">
            <TextBlock Text="Revisar proposta" FontSize="15" FontWeight="Bold" Foreground="{DynamicResource TextBrush}"/>
            <TextBlock x:Name="ReviewSummary" Margin="0,5,0,0" FontSize="12" MaxHeight="54" TextWrapping="Wrap" Foreground="{DynamicResource TextBrush}"/>
          </StackPanel>
          <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto">
            <StackPanel x:Name="ReviewList"/>
          </ScrollViewer>
          <Grid Grid.Row="2" Margin="0,10,0,2">
            <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
            <Button x:Name="DiscardButton" Grid.Column="0" Style="{StaticResource ModeButton}" Content="Voltar" Height="28" Margin="0,0,6,0" Background="#7BFFFFFF"/>
            <Button x:Name="ApplyButton" Grid.Column="1" Style="{StaticResource ActionButton}" Content="Aplicar" Height="28" Margin="6,0,0,0" ToolTip="Aplicar as mudancas listadas"/>
          </Grid>
        </Grid>
        <Grid x:Name="Composer" Visibility="Collapsed" Margin="5,0,5,0">
          <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
          <Grid Grid.Row="0" Height="25">
            <Grid.ColumnDefinitions><ColumnDefinition Width="82"/><ColumnDefinition Width="82"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
            <Button x:Name="PlanModeButton" Grid.Column="0" Style="{StaticResource ModeButton}" Content="Planejar" Height="24"/>
            <Button x:Name="ReportModeButton" Grid.Column="1" Style="{StaticResource ModeButton}" Content="Relatar" Height="24" Margin="3,0,0,0"/>
          </Grid>
          <Border x:Name="MessageSurface" Grid.Row="1" Margin="0,6,0,6" Background="#FFFFFFFF" BorderBrush="#FFFFFFFF" BorderThickness="1" CornerRadius="8">
            <Grid>
              <TextBox x:Name="MessageBox" Background="Transparent" BorderThickness="0" FontSize="12" Foreground="{DynamicResource TextBrush}"
                       Padding="8,6" AcceptsReturn="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto"/>
              <TextBlock x:Name="MessageHint" Margin="10,7" FontSize="12" Foreground="{DynamicResource TextBrush}" IsHitTestVisible="False" TextWrapping="Wrap"/>
            </Grid>
          </Border>
          <Grid Grid.Row="2" Height="30">
            <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
            <ComboBox x:Name="ProviderPicker" Grid.Column="0" Width="102" Height="26" HorizontalAlignment="Left" VerticalAlignment="Center"
                      Background="#FFFFFFFF" Foreground="{DynamicResource TextBrush}" BorderBrush="#88FFFFFF" FontSize="11" ToolTip="Modelo para interpretar a mensagem">
              <ComboBoxItem Content="Claude Code" Tag="claude" Foreground="{DynamicResource TextBrush}"/>
              <ComboBoxItem Content="Ollama" Tag="ollama" Foreground="{DynamicResource TextBrush}"/>
            </ComboBox>
            <Button x:Name="SendButton" Grid.Column="1" Style="{StaticResource ActionButton}" Content="Organizar" Width="102" Height="28"/>
          </Grid>
        </Grid>
      </Grid>
      <TextBlock x:Name="StatusText" Grid.Row="4" FontSize="10" Foreground="{DynamicResource TextBrush}" Margin="14,4,14,8" TextTrimming="CharacterEllipsis"/>
    </Grid>
  </Border>
  <Thumb x:Name="ResizeLeft" Style="{StaticResource ResizeEdge}" Width="6" HorizontalAlignment="Left" Cursor="SizeWE" ToolTip="Arraste para redimensionar"/>
  <Thumb x:Name="ResizeRight" Style="{StaticResource ResizeEdge}" Width="6" HorizontalAlignment="Right" Cursor="SizeWE" ToolTip="Arraste para redimensionar"/>
  <Thumb x:Name="ResizeTop" Style="{StaticResource ResizeEdge}" Height="6" VerticalAlignment="Top" Cursor="SizeNS" ToolTip="Arraste para redimensionar"/>
  <Thumb x:Name="ResizeBottom" Style="{StaticResource ResizeEdge}" Height="6" VerticalAlignment="Bottom" Cursor="SizeNS" ToolTip="Arraste para redimensionar"/>
  <Thumb x:Name="ResizeTopLeft" Style="{StaticResource ResizeEdge}" Width="12" Height="12" HorizontalAlignment="Left" VerticalAlignment="Top" Cursor="SizeNWSE"/>
  <Thumb x:Name="ResizeTopRight" Style="{StaticResource ResizeEdge}" Width="12" Height="12" HorizontalAlignment="Right" VerticalAlignment="Top" Cursor="SizeNESW"/>
  <Thumb x:Name="ResizeBottomLeft" Style="{StaticResource ResizeEdge}" Width="12" Height="12" HorizontalAlignment="Left" VerticalAlignment="Bottom" Cursor="SizeNESW"/>
  <Thumb x:Name="ResizeBottomRight" Style="{StaticResource ResizeEdge}" Width="12" Height="12" HorizontalAlignment="Right" VerticalAlignment="Bottom" Cursor="SizeNWSE"/>
  </Grid>
</Window>
'@

try {
  $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
  $window = [Windows.Markup.XamlReader]::Load($reader)
} catch {
  [System.Windows.MessageBox]::Show("Nao foi possivel abrir o painel: " + $_.Exception.Message, "Minha agenda") | Out-Null
  exit 1
}

foreach ($name in @("OuterShell", "TimerSurface", "MessageSurface", "Header", "DragArea", "DateText", "OpacityButton", "TextColorButton", "MinimizeButton", "CloseButton", "OpenCalendarButton", "TimerPhaseLabel", "TimerClock", "TimerToggleButton", "TimerResetButton", "Tabs", "TodayTab", "NotesTab", "AssistantTab", "TodayPane", "NextText", "TaskScroll", "TaskList", "NotesPane", "NotesBox", "ReviewPane", "ReviewSummary", "ReviewList", "DiscardButton", "ApplyButton", "Composer", "PlanModeButton", "ReportModeButton", "MessageBox", "MessageHint", "ProviderPicker", "SendButton", "StatusText", "ResizeLeft", "ResizeRight", "ResizeTop", "ResizeBottom", "ResizeBottomLeft", "ResizeBottomRight", "ResizeTopLeft", "ResizeTopRight")) {
  Set-Variable -Name $name -Value $window.FindName($name) -Scope Script
}
$script:shellShadow = $OuterShell.Effect

function Use-TextBrush($control) {
  $property = if ($control -is [System.Windows.Controls.TextBlock]) {
    [System.Windows.Controls.TextBlock]::ForegroundProperty
  } else {
    [System.Windows.Controls.Control]::ForegroundProperty
  }
  $control.SetResourceReference($property, "TextBrush")
}

$area = [System.Windows.SystemParameters]::WorkArea
$window.Height = [Math]::Min(404, [Math]::Max(310, $area.Height - 24))
$window.Left = $area.Right - $window.Width - 12
$window.Top = $area.Top + 12
$DateText.Text = (Get-Date).ToString("dddd, dd 'de' MMMM", $script:culture)

function Set-Status([string]$text, [bool]$errorState = $false) {
  $StatusText.Text = $text
  $StatusText.FontWeight = [System.Windows.FontWeights]::Bold
  $StatusText.ToolTip = $text
}

function Apply-Transparency {
  $whiteText = $script:textTone -eq "white"
  $levels = if ($whiteText) {
    @(
      @{ shell = "#FF17242A"; timer = "#FF203238"; editor = "#FF203238"; line = "#FF40565C"; label = "100%"; shadow = $true },
      @{ shell = "#72303A42"; timer = "#6B26383F"; editor = "#7626383F"; line = "#88AAB9BE"; label = "24%"; shadow = $true },
      @{ shell = "#00FFFFFF"; timer = "#00FFFFFF"; editor = "#00FFFFFF"; line = "#00FFFFFF"; label = "sem fundo"; shadow = $false }
    )
  } else {
    @(
      @{ shell = "#FFFFFFFF"; timer = "#FFFFFFFF"; editor = "#FFFFFFFF"; line = "#FFDDE4E4"; label = "100%"; shadow = $true },
      @{ shell = "#3EFFFFFF"; timer = "#35FFFFFF"; editor = "#48FFFFFF"; line = "#55FFFFFF"; label = "24%"; shadow = $true },
      @{ shell = "#00FFFFFF"; timer = "#00FFFFFF"; editor = "#00FFFFFF"; line = "#00FFFFFF"; label = "sem fundo"; shadow = $false }
    )
  }
  $level = $levels[$script:transparencyLevel]
  $colors = if ($whiteText) {
    @{ TextBrush = "#FFFFFFFF"; IconHoverBrush = "#55415B63"; IconPressedBrush = "#885A747C"; ActionBrush = "#FF30575D"; ActionHoverBrush = "#FF3D696F"; ActionPressedBrush = "#FF27484D" }
  } elseif ($script:textTone -eq "neutral") {
    @{ TextBrush = "#FF757575"; IconHoverBrush = "#44FFFFFF"; IconPressedBrush = "#77FFFFFF"; ActionBrush = "#FFFFFFFF"; ActionHoverBrush = "#FFFFFFFF"; ActionPressedBrush = "#FFFFFFFF" }
  } else {
    @{ TextBrush = "#FF000000"; IconHoverBrush = "#62FFFFFF"; IconPressedBrush = "#A7FFFFFF"; ActionBrush = "#FFE0F0F0"; ActionHoverBrush = "#FFCEE7E7"; ActionPressedBrush = "#FFB8DADA" }
  }
  foreach ($key in $colors.Keys) {
    $window.Resources[$key] = Brush $colors[$key]
  }
  $OuterShell.Background = Brush $level.shell
  $OuterShell.BorderBrush = Brush $level.line
  $OuterShell.Effect = if ($level.shadow) { $script:shellShadow } else { $null }
  $TimerSurface.Background = Brush $level.timer
  $TimerSurface.BorderBrush = Brush $level.line
  $NotesPane.Background = Brush $level.editor
  $NotesPane.BorderBrush = Brush $level.line
  $MessageSurface.Background = Brush $level.editor
  $MessageSurface.BorderBrush = Brush $level.line
  $pickerBackground = if ($whiteText) { "#FF203238" } else { "#FFFFFFFF" }
  $ProviderPicker.Background = Brush $pickerBackground
  foreach ($item in $ProviderPicker.Items) { $item.Background = Brush $pickerBackground }
  $OpacityButton.ToolTip = "Transparencia: " + $level.label + ". Clique para alternar."
  $TextColorButton.ToolTip = switch ($script:textTone) {
    "white" { "Texto branco. Clique para usar cinza neutro." }
    "neutral" { "Texto cinza neutro. Clique para usar preto." }
    default { "Texto preto. Clique para usar branco." }
  }
  if (-not $script:pendingProposal) { Show-Tab $script:tab }
  Set-Mode $script:mode
  if ($script:blocks.Count -gt 0) { Render-Checklist ([pscustomobject]@{ blocks = $script:blocks }) }
}

function Save-OverlaySettings {
  try {
    [IO.Directory]::CreateDirectory($script:storageRoot) | Out-Null
    $settings = @{ width = $window.Width; height = $window.Height; left = $window.Left; top = $window.Top; transparency = $script:transparencyLevel; textTone = $script:textTone }
    [IO.File]::WriteAllText($script:settingsPath, (ConvertTo-Json -InputObject $settings -Compress), [Text.UTF8Encoding]::new($false))
  } catch {
    Set-Status ("Nao foi possivel salvar o tamanho do painel: " + $_.Exception.Message) $true
  }
}

function Load-OverlaySettings {
  if (-not [IO.File]::Exists($script:settingsPath)) { Apply-Transparency; return }
  try {
    $settings = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($script:settingsPath))
    $window.Width = [Math]::Min([Math]::Max($window.MinWidth, [double]$settings.width), $area.Width - 12)
    $window.Height = [Math]::Min([Math]::Max($window.MinHeight, [double]$settings.height), $area.Height - 12)
    $window.Left = [Math]::Min([Math]::Max($area.Left, [double]$settings.left), $area.Right - $window.Width)
    $window.Top = [Math]::Min([Math]::Max($area.Top, [double]$settings.top), $area.Bottom - $window.Height)
    $script:transparencyLevel = [Math]::Min(2, [Math]::Max(0, [int]$settings.transparency))
    if ($settings.textTone -in @("black", "white", "neutral")) {
      $script:textTone = [string]$settings.textTone
    } elseif ($null -ne $settings.whiteText) {
      $script:textTone = if ([bool]$settings.whiteText) { "white" } else { "black" }
    }
  } catch {
    Set-Status "Preferencias visuais reiniciadas." $true
  }
  Apply-Transparency
}

function Resize-Overlay([string]$edge, [double]$dx, [double]$dy) {
  if ($edge -match "Left") {
    $right = $window.Left + $window.Width
    $newLeft = [Math]::Min($right - $window.MinWidth, [Math]::Max($area.Left, $window.Left + $dx))
    $window.Width = $right - $newLeft
    $window.Left = $newLeft
  } elseif ($edge -match "Right") {
    $window.Width = [Math]::Max($window.MinWidth, [Math]::Min($area.Right - $window.Left, $window.Width + $dx))
  }
  if ($edge -match "Top") {
    $bottom = $window.Top + $window.Height
    $newTop = [Math]::Min($bottom - $window.MinHeight, [Math]::Max($area.Top, $window.Top + $dy))
    $window.Height = $bottom - $newTop
    $window.Top = $newTop
  } elseif ($edge -match "Bottom") {
    $window.Height = [Math]::Max($window.MinHeight, [Math]::Min($area.Bottom - $window.Top, $window.Height + $dy))
  }
}

function Show-Tab([string]$tab) {
  $script:tab = $tab
  $TodayPane.Visibility = if ($tab -eq "today") { [System.Windows.Visibility]::Visible } else { [System.Windows.Visibility]::Collapsed }
  $NotesPane.Visibility = if ($tab -eq "notes") { [System.Windows.Visibility]::Visible } else { [System.Windows.Visibility]::Collapsed }
  $Composer.Visibility = if ($tab -eq "assistant") { [System.Windows.Visibility]::Visible } else { [System.Windows.Visibility]::Collapsed }
  foreach ($pair in @(@($TodayTab, "today"), @($NotesTab, "notes"), @($AssistantTab, "assistant"))) {
    $shade = if ($script:transparencyLevel -eq 2) { "#00FFFFFF" } elseif ($script:textTone -eq "white") { if ($script:transparencyLevel -eq 1) { "#86394C53" } else { "#FF284A51" } } elseif ($script:transparencyLevel -eq 1) { "#55FFFFFF" } else { "#FFE7F0F0" }
    $pair[0].Background = Brush $(if ($tab -eq $pair[1]) { $shade } else { "#00FFFFFF" })
    $pair[0].FontWeight = [System.Windows.FontWeights]::Bold
  }
}

function Save-Notes {
  try {
    [IO.Directory]::CreateDirectory($script:storageRoot) | Out-Null
    [IO.File]::WriteAllText($script:notesPath, $NotesBox.Text, [Text.UTF8Encoding]::new($false))
    if ($script:tab -eq "notes") { Set-Status "Notas salvas neste computador" }
  } catch {
    Set-Status ("Nao foi possivel salvar as notas: " + $_.Exception.Message) $true
  }
}

function Load-Notes {
  try {
    if ([IO.File]::Exists($script:notesPath)) { $NotesBox.Text = [IO.File]::ReadAllText($script:notesPath) }
  } catch {
    Set-Status ("Nao foi possivel abrir as notas: " + $_.Exception.Message) $true
  } finally {
    $script:notesLoading = $false
  }
}

function Phase-Duration([string]$phase) {
  switch ($phase) {
    "shortBreak" { return 5 * 60 }
    "longBreak" { return 15 * 60 }
    default { return 25 * 60 }
  }
}

function Save-TimerState {
  try {
    [IO.Directory]::CreateDirectory($script:storageRoot) | Out-Null
    $state = @{
      phase = $script:timerPhase
      remaining = $script:timerRemaining
      running = $script:timerRunning
      endAt = if ($script:timerEndAt) { $script:timerEndAt.ToString("o") } else { $null }
      completed = $script:focusCount
    }
    [IO.File]::WriteAllText($script:timerPath, (ConvertTo-Json -InputObject $state -Compress), [Text.UTF8Encoding]::new($false))
  } catch {
    Set-Status ("Nao foi possivel salvar o timer: " + $_.Exception.Message) $true
  }
}

function Load-TimerState {
  if (-not [IO.File]::Exists($script:timerPath)) { return }
  try {
    $state = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($script:timerPath))
    if ($state.phase -in @("focus", "shortBreak", "longBreak")) { $script:timerPhase = $state.phase }
    $duration = Phase-Duration $script:timerPhase
    $script:timerRemaining = [Math]::Min($duration, [Math]::Max(1, [int]$state.remaining))
    $script:focusCount = [Math]::Max(0, [int]$state.completed)
    if ($state.running -and $state.endAt) {
      $script:timerEndAt = [DateTimeOffset]::Parse([string]$state.endAt)
      $script:timerRemaining = [Math]::Max(0, [int][Math]::Ceiling(($script:timerEndAt - [DateTimeOffset]::Now).TotalSeconds))
      if ($script:timerRemaining -eq 0) {
        if ($script:timerPhase -eq "focus") {
          $script:focusCount++
          $script:timerPhase = if ($script:focusCount % 4 -eq 0) { "longBreak" } else { "shortBreak" }
        } else {
          $script:timerPhase = "focus"
        }
        $script:timerRemaining = Phase-Duration $script:timerPhase
        $script:timerEndAt = $null
      } else {
        $script:timerRunning = $true
      }
    }
  } catch {
    $script:timerPhase = "focus"
    $script:timerRemaining = 25 * 60
    $script:timerRunning = $false
    $script:timerEndAt = $null
    Set-Status "Timer reiniciado apos erro ao ler o estado anterior." $true
  }
}

function Update-TimerDisplay {
  $minutes = [Math]::Floor($script:timerRemaining / 60)
  $seconds = $script:timerRemaining % 60
  $TimerClock.Text = "{0:00}:{1:00}" -f $minutes, $seconds
  $TimerPhaseLabel.Text = if ($script:timerPhase -eq "focus") {
    "FOCO " + (($script:focusCount % 4) + 1) + "/4"
  } elseif ($script:timerPhase -eq "longBreak") {
    "PAUSA LONGA"
  } else {
    "PAUSA"
  }
  $TimerToggleButton.Content = if ($script:timerRunning) { "Pausar" } else { "Iniciar" }
}

function Notify-Timer([string]$title, [string]$message) {
  Set-Status $message
  try {
    [System.Media.SystemSounds]::Asterisk.Play()
    if ($script:tray) {
      $script:tray.BalloonTipTitle = $title
      $script:tray.BalloonTipText = $message
      $script:tray.ShowBalloonTip(6000)
    }
  } catch {}
}

function Advance-Timer {
  if ($script:timerPhase -eq "focus") {
    $script:focusCount++
    $script:timerPhase = if ($script:focusCount % 4 -eq 0) { "longBreak" } else { "shortBreak" }
    $script:timerRemaining = Phase-Duration $script:timerPhase
    $script:timerEndAt = [DateTimeOffset]::Now.AddSeconds($script:timerRemaining)
    Notify-Timer "Pomodoro" (LocalText "Foco conclu&#237;do. Hora da pausa.")
  } else {
    $script:timerPhase = "focus"
    $script:timerRemaining = Phase-Duration "focus"
    $script:timerRunning = $false
    $script:timerEndAt = $null
    Notify-Timer "Pomodoro" (LocalText "Pausa conclu&#237;da. Pronto para outro foco.")
  }
  Save-TimerState
  Update-TimerDisplay
}

function Set-Mode([string]$mode) {
  $script:mode = $mode
  $selectedShade = if ($script:textTone -eq "white") { "#FF284A51" } else { "#D1EDF1F1" }
  $PlanModeButton.Background = Brush $(if ($mode -eq "auto") { $selectedShade } else { "#00FFFFFF" })
  $PlanModeButton.FontWeight = [System.Windows.FontWeights]::Bold
  $ReportModeButton.Background = Brush $(if ($mode -eq "report") { $selectedShade } else { "#00FFFFFF" })
  $ReportModeButton.FontWeight = [System.Windows.FontWeights]::Bold
  $MessageHint.Text = LocalText $(if ($mode -eq "report") { "O que voc&#234; fez hoje? O que impediu o restante?" } else { "O que voc&#234; quer organizar ou mudar?" })
  $SendButton.Content = if ($mode -eq "report") { "Adaptar rotina" } else { "Organizar" }
}

function Start-AgendaRequest {
  param([string]$Path, [string]$Method = "GET", [object]$Body, [scriptblock]$Success, [scriptblock]$Failure)
  try {
    $content = $null
    if ($Method -eq "GET") {
      $task = $script:client.GetAsync($script:serverUrl + $Path)
    } else {
      $json = ConvertTo-Json -InputObject $Body -Depth 12 -Compress
      $content = New-Object System.Net.Http.StringContent ($json, [Text.Encoding]::UTF8, "application/json")
      $task = $script:client.PostAsync($script:serverUrl + $Path, $content)
    }
    [void]$script:requests.Add([pscustomobject]@{ Task = $task; Content = $content; Success = $Success; Failure = $Failure })
    $script:requestTimer.Start()
  } catch {
    if ($content) { $content.Dispose() }
    & $Failure $_.Exception.Message
  }
}

$script:requestTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:requestTimer.Interval = [TimeSpan]::FromMilliseconds(180)
$script:requestTimer.Add_Tick({
  for ($i = $script:requests.Count - 1; $i -ge 0; $i--) {
    $request = $script:requests[$i]
    if (-not $request.Task.IsCompleted) { continue }
    $script:requests.RemoveAt($i)
    $response = $null
    try {
      $response = $request.Task.GetAwaiter().GetResult()
      $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      $data = if ($body) { ConvertFrom-Json -InputObject $body } else { $null }
      if (-not $response.IsSuccessStatusCode) {
        $detail = if ($data.error) { $data.error } else { "Erro HTTP " + [int]$response.StatusCode }
        throw $detail
      }
      & $request.Success $data
    } catch {
      & $request.Failure $_.Exception.Message
    } finally {
      if ($response) { $response.Dispose() }
      if ($request.Content) { $request.Content.Dispose() }
    }
  }
  if ($script:requests.Count -eq 0) { $script:requestTimer.Stop() }
})

function Add-ReviewItem([string]$heading, [string]$body, [string]$color) {
  $row = New-Object System.Windows.Controls.Border
  $row.BorderBrush = Brush "#90FFFFFF"
  $row.BorderThickness = [System.Windows.Thickness]::new(0, 0, 0, 1)
  $row.Padding = [System.Windows.Thickness]::new(2, 7, 2, 7)
  $stack = New-Object System.Windows.Controls.StackPanel
  $title = New-Object System.Windows.Controls.TextBlock
  $title.Text = $heading
  $title.FontSize = 12
  $title.FontWeight = [System.Windows.FontWeights]::Bold
  Use-TextBrush $title
  $title.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $stack.Children.Add($title) | Out-Null
  if ($body) {
    $detail = New-Object System.Windows.Controls.TextBlock
    $detail.Text = $body
    $detail.FontSize = 11
    $detail.FontWeight = [System.Windows.FontWeights]::Bold
    Use-TextBrush $detail
    $detail.TextWrapping = [System.Windows.TextWrapping]::Wrap
    $detail.Margin = [System.Windows.Thickness]::new(0, 3, 0, 0)
    $stack.Children.Add($detail) | Out-Null
  }
  $row.Child = $stack
  $ReviewList.Children.Add($row) | Out-Null
}

function Show-Review($result) {
  $script:pendingProposal = $result
  $ReviewSummary.Text = [string]$result.summary
  $ReviewList.Children.Clear()
  $changes = @($result.changes | Where-Object { $_ })
  foreach ($change in $changes) {
    $verb = switch ($change.action) { "create" { "Adicionar" } "edit" { "Editar" } "delete" { "Remover" } "complete" { "Concluir" } default { "Alterar" } }
    $kind = switch ($change.entity) { "goal" { "meta" } "report" { "relato" } default { "agenda" } }
    $color = if ($change.action -eq "delete") { "#AC4655" } elseif ($change.entity -eq "goal") { "#7752A6" } else { "#176D73" }
    Add-ReviewItem ($verb + " " + $kind + ": " + $change.title) ([string]$change.reason) $color
  }
  $warnings = @($result.warnings | Where-Object { $_ })
  foreach ($warning in $warnings) {
    Add-ReviewItem "Pendente no planejamento" ($warning.text + ": " + $warning.reason) "#9B661E"
  }
  if ($changes.Count -eq 0 -and $warnings.Count -eq 0) {
    Add-ReviewItem (LocalText "Nenhuma mudan&#231;a proposta") "Descreva o que deve mudar e tente novamente." "#64717B"
  }
  $ApplyButton.IsEnabled = $changes.Count -gt 0
  $Tabs.IsEnabled = $false
  $TodayPane.Visibility = [System.Windows.Visibility]::Collapsed
  $NotesPane.Visibility = [System.Windows.Visibility]::Collapsed
  $Composer.Visibility = [System.Windows.Visibility]::Collapsed
  $ReviewPane.Visibility = [System.Windows.Visibility]::Visible
}

function Hide-Review([string]$returnTab = "assistant") {
  $ReviewPane.Visibility = [System.Windows.Visibility]::Collapsed
  $Tabs.IsEnabled = $true
  Show-Tab $returnTab
  $script:pendingProposal = $null
}

function New-TaskRow($block) {
  $row = New-Object System.Windows.Controls.Border
  $row.CornerRadius = [System.Windows.CornerRadius]::new(8)
  $row.BorderBrush = Brush "#78FFFFFF"
  $row.BorderThickness = [System.Windows.Thickness]::new(0, 0, 0, 1)
  $row.Padding = [System.Windows.Thickness]::new(3, 5, 4, 5)
  $row.Margin = [System.Windows.Thickness]::new(0, 0, 0, 2)
  $now = Get-Date
  $start = [DateTime]$block.start
  $end = [DateTime]$block.end
  if (-not $block.completed -and $start -le $now -and $end -gt $now) {
    $highlight = if ($script:textTone -eq "white") { @("#FF284A51", "#86394C53", "#00FFFFFF")[$script:transparencyLevel] } else { @("#FFE7F0F0", "#5AFFFFFF", "#00FFFFFF")[$script:transparencyLevel] }
    $row.Background = Brush $highlight
  }
  $grid = New-Object System.Windows.Controls.Grid
  foreach ($width in @("3", "54", "*", "27")) {
    $column = New-Object System.Windows.Controls.ColumnDefinition
    $column.Width = [System.Windows.GridLengthConverter]::new().ConvertFromString($width)
    $grid.ColumnDefinitions.Add($column) | Out-Null
  }
  $accent = if ($null -ne $block.goalColorIndex) { $script:goalColors[[int]$block.goalColorIndex % $script:goalColors.Count] } elseif ($block.type -eq "routine") { "#21816A" } elseif ($block.type -eq "event") { "#BD7B12" } else { "#246EAA" }
  $line = New-Object System.Windows.Controls.Border
  $line.Background = Brush $accent
  $line.CornerRadius = [System.Windows.CornerRadius]::new(2)
  $line.Margin = [System.Windows.Thickness]::new(0, 1, 0, 1)
  [System.Windows.Controls.Grid]::SetColumn($line, 0)
  $grid.Children.Add($line) | Out-Null
  $time = New-Object System.Windows.Controls.TextBlock
  $time.Text = $start.ToString("HH:mm")
  $time.FontSize = 12
  $time.FontWeight = [System.Windows.FontWeights]::Bold
  Use-TextBrush $time
  $time.Margin = [System.Windows.Thickness]::new(7, 3, 0, 0)
  [System.Windows.Controls.Grid]::SetColumn($time, 1)
  $grid.Children.Add($time) | Out-Null
  $content = New-Object System.Windows.Controls.StackPanel
  $taskTitle = New-Object System.Windows.Controls.TextBlock
  $taskTitle.Text = [string]$block.title
  $taskTitle.FontSize = 12
  $taskTitle.FontWeight = [System.Windows.FontWeights]::Bold
  Use-TextBrush $taskTitle
  if ($block.completed) { $taskTitle.TextDecorations = [System.Windows.TextDecorations]::Strikethrough }
  $taskTitle.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $taskTitle.MaxHeight = 36
  $taskTitle.ToolTip = $block.title
  $content.Children.Add($taskTitle) | Out-Null
  $meta = New-Object System.Windows.Controls.TextBlock
  $kind = if ($block.goalTitle) { $block.goalTitle } elseif ($block.type -eq "routine") { "Rotina" } elseif ($block.type -eq "event") { "Compromisso" } else { "Tarefa" }
  $meta.Text = $kind + "  .  " + $end.ToString("HH:mm")
  $meta.FontSize = 10
  $meta.FontWeight = [System.Windows.FontWeights]::Bold
  Use-TextBrush $meta
  $meta.TextTrimming = [System.Windows.TextTrimming]::CharacterEllipsis
  $meta.Margin = [System.Windows.Thickness]::new(0, 3, 0, 0)
  $content.Children.Add($meta) | Out-Null
  [System.Windows.Controls.Grid]::SetColumn($content, 2)
  $grid.Children.Add($content) | Out-Null
  $check = New-Object System.Windows.Controls.Button
  $check.Style = $window.FindResource("IconButton")
  $check.Content = if ($block.completed) { [char]0x2713 } else { [char]0x25CB }
  Use-TextBrush $check
  $check.FontSize = 19
  $check.Width = 25
  $check.Height = 25
  $check.IsEnabled = -not [bool]$block.completed
  $check.ToolTip = if ($block.completed) { "Concluido" } else { "Marcar bloco como concluido" }
  $check.Tag = $block
  $check.Add_Click({
    param($sender, $eventArgs)
    $sender.IsEnabled = $false
    $item = $sender.Tag
    Set-Status "Salvando conclusao..."
    Start-AgendaRequest "/api/overlay/complete" "POST" @{ entryId = $item.entryId; occurrenceDate = $item.occurrenceDate; start = $item.start } {
      param($saved)
      $script:statusAfterRefresh = LocalText "Bloco conclu&#237;do"
      Refresh-Checklist
    } {
      param($errorText)
      $sender.IsEnabled = $true
      Set-Status $errorText $true
    }.GetNewClosure()
  })
  [System.Windows.Controls.Grid]::SetColumn($check, 3)
  $grid.Children.Add($check) | Out-Null
  $row.Child = $grid
  return $row
}

function Render-Checklist($data) {
  $DateText.Text = (Get-Date).ToString("dddd, dd 'de' MMMM", $script:culture)
  $script:blocks = @($data.blocks)
  $done = @($script:blocks | Where-Object { $_.completed }).Count
  $total = $script:blocks.Count
  $TodayTab.Content = if ($total -eq 0) { "Hoje" } else { "Hoje $done/$total" }
  $next = @($script:blocks | Where-Object { -not $_.completed } | Select-Object -First 1)
  $NextText.Text = if ($next.Count) { (LocalText "Pr&#243;ximo: ") + ([DateTime]$next[0].start).ToString("HH:mm") + "  " + $next[0].title } else { LocalText "Seu dia est&#225; em dia." }
  $TaskList.Children.Clear()
  if ($total -eq 0) {
    $empty = New-Object System.Windows.Controls.TextBlock
    $empty.Text = "Dia livre por enquanto."
    $empty.FontSize = 14
    $empty.FontWeight = [System.Windows.FontWeights]::Bold
    Use-TextBrush $empty
    $empty.Margin = [System.Windows.Thickness]::new(15, 20, 0, 0)
    $TaskList.Children.Add($empty) | Out-Null
  }
  foreach ($block in $script:blocks) { $TaskList.Children.Add((New-TaskRow $block)) | Out-Null }
}

function Refresh-Checklist {
  if ($script:refreshing) { return }
  $script:refreshing = $true
  Start-AgendaRequest "/api/overlay" "GET" $null {
    param($data)
    $script:refreshing = $false
    Render-Checklist $data
    if ($script:statusAfterRefresh) {
      Set-Status $script:statusAfterRefresh
      $script:statusAfterRefresh = $null
    } elseif (-not $script:pendingProposal -and $script:tab -eq "today") { Set-Status "Agenda atualizada" }
  } {
    param($errorText)
    $script:refreshing = $false
    $script:statusAfterRefresh = $null
    Set-Status ("Agenda indisponivel: " + $errorText) $true
  }
}

$TodayTab.Add_Click({ Show-Tab "today" })
$NotesTab.Add_Click({ Show-Tab "notes"; $NotesBox.Focus() | Out-Null })
$AssistantTab.Add_Click({ Show-Tab "assistant"; $MessageBox.Focus() | Out-Null })
$OpacityButton.Add_Click({
  $script:transparencyLevel = ($script:transparencyLevel + 1) % 3
  Apply-Transparency
  Save-OverlaySettings
})
$TextColorButton.Add_Click({
  $tones = @("black", "white", "neutral")
  $script:textTone = $tones[([Array]::IndexOf($tones, $script:textTone) + 1) % $tones.Count]
  Apply-Transparency
  Save-OverlaySettings
})
foreach ($edge in @("Left", "Right", "Top", "Bottom", "TopLeft", "TopRight", "BottomLeft", "BottomRight")) {
  $handle = Get-Variable -Name ("Resize" + $edge) -ValueOnly
  $handle.Tag = $edge
  $handle.Add_DragDelta({
    param($sender, $eventArgs)
    Resize-Overlay ([string]$sender.Tag) $eventArgs.HorizontalChange $eventArgs.VerticalChange
  })
  $handle.Add_DragCompleted({ Save-OverlaySettings })
}
$PlanModeButton.Add_Click({ Set-Mode "auto" })
$ReportModeButton.Add_Click({ Set-Mode "report" })
$MessageBox.Add_TextChanged({ $MessageHint.Visibility = if ($MessageBox.Text.Length) { [System.Windows.Visibility]::Collapsed } else { [System.Windows.Visibility]::Visible } })
$script:notesTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:notesTimer.Interval = [TimeSpan]::FromMilliseconds(650)
$script:notesTimer.Add_Tick({ $script:notesTimer.Stop(); Save-Notes })
$NotesBox.Add_TextChanged({
  if ($script:notesLoading) { return }
  Set-Status "Salvando notas..."
  $script:notesTimer.Stop()
  $script:notesTimer.Start()
})
$script:pomodoroTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:pomodoroTimer.Interval = [TimeSpan]::FromSeconds(1)
$script:pomodoroTimer.Add_Tick({
  if (-not $script:timerRunning) { return }
  $script:timerRemaining = [Math]::Max(0, [int][Math]::Ceiling(($script:timerEndAt - [DateTimeOffset]::Now).TotalSeconds))
  if ($script:timerRemaining -eq 0) { Advance-Timer } else { Update-TimerDisplay }
})
$TimerToggleButton.Add_Click({
  if ($script:timerRunning) {
    $script:timerRemaining = [Math]::Max(1, [int][Math]::Ceiling(($script:timerEndAt - [DateTimeOffset]::Now).TotalSeconds))
    $script:timerRunning = $false
    $script:timerEndAt = $null
  } else {
    $script:timerEndAt = [DateTimeOffset]::Now.AddSeconds($script:timerRemaining)
    $script:timerRunning = $true
  }
  Save-TimerState
  Update-TimerDisplay
})
$TimerResetButton.Add_Click({
  $script:timerRunning = $false
  $script:timerEndAt = $null
  $script:timerRemaining = Phase-Duration $script:timerPhase
  Save-TimerState
  Update-TimerDisplay
})
$DragArea.Add_MouseLeftButtonDown({ $window.DragMove(); Save-OverlaySettings })
$MinimizeButton.Add_Click({ $window.WindowState = [System.Windows.WindowState]::Minimized })
$CloseButton.Add_Click({ $window.Close() })
$OpenCalendarButton.Add_Click({ Start-Process $script:serverUrl })
$DiscardButton.Add_Click({ Hide-Review "assistant"; Set-Status "Proposta descartada" })
$SendButton.Add_Click({
  $text = $MessageBox.Text.Trim()
  if (-not $text) { Set-Status "Escreva uma mensagem primeiro." $true; $MessageBox.Focus() | Out-Null; return }
  $Composer.IsEnabled = $false
  $SendButton.Content = "Pensando..."
  Set-Status "A IA esta organizando sua mensagem..."
  $provider = [string]$ProviderPicker.SelectedItem.Tag
  Start-AgendaRequest "/api/interpret" "POST" @{ message = $text; mode = $script:mode; intent = "message"; provider = $provider } {
    param($result)
    $Composer.IsEnabled = $true
    Set-Mode $script:mode
    if (-not $result.proposalId) { Set-Status "A IA nao gerou uma proposta." $true; return }
    Show-Review $result
  } {
    param($errorText)
    $Composer.IsEnabled = $true
    Set-Mode $script:mode
    Set-Status $errorText $true
  }
})
$ApplyButton.Add_Click({
  if (-not $script:pendingProposal.proposalId) { return }
  $ApplyButton.IsEnabled = $false
  $DiscardButton.IsEnabled = $false
  $ApplyButton.Content = "Salvando..."
  Start-AgendaRequest ("/api/proposals/" + $script:pendingProposal.proposalId + "/apply") "POST" @{} {
    param($saved)
    $ApplyButton.Content = "Aplicar"
    $DiscardButton.IsEnabled = $true
    $MessageBox.Clear()
    Hide-Review "today"
    $script:statusAfterRefresh = "Alteracoes salvas na agenda"
    Refresh-Checklist
  } {
    param($errorText)
    $ApplyButton.Content = "Aplicar"
    $ApplyButton.IsEnabled = $true
    $DiscardButton.IsEnabled = $true
    $ReviewSummary.Text = $errorText
  }
})

$script:refreshTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:refreshTimer.Interval = [TimeSpan]::FromMinutes(1)
$script:refreshTimer.Add_Tick({ Refresh-Checklist })
$window.Add_Closed({
  $script:refreshTimer.Stop()
  $script:requestTimer.Stop()
  $script:notesTimer.Stop()
  $script:pomodoroTimer.Stop()
  if (-not $script:notesLoading) { Save-Notes }
  Save-TimerState
  Save-OverlaySettings
  if ($script:tray) { $script:tray.Visible = $false; $script:tray.Dispose() }
  $script:client.Dispose()
  if ($script:startedServer -and -not $script:startedServer.HasExited) {
    Stop-Process -Id $script:startedServer.Id -Force
  }
})

if (Ensure-AgendaServer) {
  Load-OverlaySettings
  Load-Notes
  Load-TimerState
  Update-TimerDisplay
  Show-Tab "today"
  $script:tray = New-Object System.Windows.Forms.NotifyIcon
  $script:tray.Icon = [System.Drawing.SystemIcons]::Information
  $script:tray.Text = "Minha agenda"
  $script:tray.Visible = $true
  $script:tray.Add_DoubleClick({
    $window.WindowState = [System.Windows.WindowState]::Normal
    $window.Activate() | Out-Null
  })
  $defaultProvider = [string]$script:aiStatus.defaultProvider
  $claudeReady = [bool]$script:aiStatus.providers.claude.available
  $ollamaReady = [bool]$script:aiStatus.providers.ollama.available
  $ProviderPicker.SelectedIndex = if (($defaultProvider -eq "claude" -and $claudeReady) -or (-not $ollamaReady -and $claudeReady)) { 0 } else { 1 }
  Set-Mode "auto"
  Refresh-Checklist
  $script:refreshTimer.Start()
  $script:pomodoroTimer.Start()
  $console = [OverlayWindow]::GetConsoleWindow()
  if ($console -ne [IntPtr]::Zero) { [OverlayWindow]::ShowWindow($console, 0) | Out-Null }
  [void]$window.ShowDialog()
}
